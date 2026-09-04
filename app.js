(function(){

  const CONFIG = {
    OWNER_GITHUB_USERNAME: 'sudo-Sentiq', 
    REPO_OWNER: 'sudo-Sentiq',              
    REPO_NAME: 'floriankannkeinleague',                   
    BRANCH: 'main',                                  
    DATA_PATH: 'data/clips.json'
  };

  const RAW_DATA_URL = 'https://raw.githubusercontent.com/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/' + CONFIG.BRANCH + '/' + CONFIG.DATA_PATH;
  const CONTENTS_API_URL = 'https://api.github.com/repos/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/contents/' + CONFIG.DATA_PATH;

  // in-memory only — never persisted, cleared on reload
  let ownerToken = null;

  const state = { frames: [], frameSeq: 0, videoEl: null, captureAllowed: false };

  // ---------- unicode-safe base64 ----------
  function b64Encode(str){
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (m,p)=>String.fromCharCode('0x'+p)));
  }
  function b64Decode(str){
    return decodeURIComponent(atob(str).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  }
  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str||'';
    return d.innerHTML;
  }

  // ============================================================
  // AUTH — a real GitHub personal access token, verified by GitHub itself.
  // We only check that the token's account matches the configured owner;
  // GitHub's own API enforces whether that token can actually write to the repo.
  // ============================================================
  const ownerToggleBtn = document.getElementById('ownerToggleBtn');
  const ownerArea = document.getElementById('ownerArea');
  const ownerBadge = document.getElementById('ownerBadge');
  const loginPanel = document.getElementById('loginPanel');
  const loginError = document.getElementById('loginError');
  const tokenInput = document.getElementById('tokenInput');

  function setSignedIn(login){
    ownerArea.style.display = 'block';
    ownerBadge.style.display = 'inline-block';
    ownerBadge.textContent = 'Owner mode · ' + login;
    ownerToggleBtn.textContent = 'Sign out';
    loginPanel.style.display = 'none';
    renderManageList();
  }
  function setSignedOut(){
    ownerToken = null;
    ownerArea.style.display = 'none';
    ownerBadge.style.display = 'none';
    ownerToggleBtn.textContent = 'Owner sign in';
    loginPanel.style.display = 'none';
  }

  ownerToggleBtn.addEventListener('click', ()=>{
    if(ownerToken){ setSignedOut(); return; }
    loginPanel.style.display = loginPanel.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('tokenSubmitBtn').addEventListener('click', async ()=>{
    loginError.style.display = 'none';
    const token = tokenInput.value.trim();
    if(!token) return;
    try{
      const res = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
      });
      if(!res.ok) throw new Error('GitHub rejected that token (' + res.status + ')');
      const user = await res.json();
      if(user.login.toLowerCase() !== CONFIG.OWNER_GITHUB_USERNAME.toLowerCase()){
        loginError.textContent = 'Signed in as ' + user.login + ', but this site is configured for ' + CONFIG.OWNER_GITHUB_USERNAME + '.';
        loginError.style.display = 'block';
        return;
      }
      ownerToken = token;
      tokenInput.value = '';
      setSignedIn(user.login);
    }catch(err){
      loginError.textContent = err.message;
      loginError.style.display = 'block';
    }
  });

  // ============================================================
  // GitHub-backed storage — publishing commits data/clips.json to the repo.
  // ============================================================
  async function fetchClipsForWrite(){
    const res = await fetch(CONTENTS_API_URL + '?ref=' + CONFIG.BRANCH, {
      headers: { 'Authorization': 'Bearer ' + ownerToken, 'Accept': 'application/vnd.github+json' }
    });
    if(res.status === 404) return { sha: null, clips: [] };
    if(!res.ok) throw new Error('Could not read current data (' + res.status + ')');
    const json = await res.json();
    let clips = [];
    try{ clips = JSON.parse(b64Decode(json.content.replace(/\n/g,''))); }catch(e){ clips = []; }
    return { sha: json.sha, clips };
  }

  async function saveClips(clips, sha, message){
    const body = {
      message,
      content: b64Encode(JSON.stringify(clips, null, 2)),
      branch: CONFIG.BRANCH
    };
    if(sha) body.sha = sha;
    const res = await fetch(CONTENTS_API_URL, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + ownerToken,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if(!res.ok){
      const errBody = await res.json().catch(()=>({}));
      throw new Error(errBody.message || ('GitHub rejected the write (' + res.status + ')'));
    }
  }

  // ---------- github clip loading (for the owner's composer) ----------
  const videoShell = document.getElementById('videoShell');
  const captureRow = document.getElementById('captureRow');
  const timeLabel = document.getElementById('timeLabel');
  const loadError = document.getElementById('loadError');

  function fmtTime(sec){
    sec = Math.max(0, Math.floor(sec||0));
    return Math.floor(sec/60) + ':' + String(sec%60).padStart(2,'0');
  }

  function normalizeGithubUrl(url){
    const m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/);
    if(m) return 'https://raw.githubusercontent.com/'+m[1]+'/'+m[2]+'/'+m[3]+'/'+m[4];
    return url;
  }

  document.getElementById('loadGhBtn').addEventListener('click', ()=>{
    loadError.style.display = 'none';
    const raw = document.getElementById('githubUrl').value.trim();
    if(!raw) return;
    const url = normalizeGithubUrl(raw);
    videoShell.innerHTML = '';
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.crossOrigin = 'anonymous';
    v.addEventListener('error', ()=>{
      loadError.textContent = "Couldn't load that link as a video. Double check it points straight at the file.";
      loadError.style.display = 'block';
    });
    videoShell.appendChild(v);
    state.videoEl = v;
    state.captureAllowed = true;
    captureRow.style.display = 'flex';
    v.addEventListener('timeupdate', ()=>{ timeLabel.textContent = fmtTime(v.currentTime); });
  });

  // ---------- frame capture ----------
  const filmstrip = document.getElementById('filmstrip');
  const analyzeBtn = document.getElementById('analyzeBtn');

  function addFrame(dataUrl, label){
    state.frames.push({id: ++state.frameSeq, dataUrl, label});
    renderFilmstrip();
  }
  function renderFilmstrip(){
    filmstrip.innerHTML = '';
    state.frames.forEach(fr=>{
      const card = document.createElement('div');
      card.className = 'frame-card';
      card.innerHTML = '<img src="'+fr.dataUrl+'"><div class="tag">'+fr.label+'</div><button class="remove">&times;</button>';
      card.querySelector('.remove').addEventListener('click', ()=>{
        state.frames = state.frames.filter(x=>x.id!==fr.id);
        renderFilmstrip();
      });
      filmstrip.appendChild(card);
    });
    analyzeBtn.disabled = state.frames.length === 0;
  }

  document.getElementById('captureBtn').addEventListener('click', ()=>{
    if(!state.videoEl || !state.captureAllowed) return;
    loadError.style.display = 'none';
    try{
      const canvas = document.createElement('canvas');
      canvas.width = state.videoEl.videoWidth || 640;
      canvas.height = state.videoEl.videoHeight || 360;
      canvas.getContext('2d').drawImage(state.videoEl, 0, 0, canvas.width, canvas.height);
      addFrame(canvas.toDataURL('image/jpeg', 0.85), fmtTime(state.videoEl.currentTime));
    }catch(err){
      loadError.textContent = "This link blocks in-browser frame capture (no CORS). Use the file's raw.githubusercontent.com link instead of the github.com blob link.";
      loadError.style.display = 'block';
    }
  });

  function makeThumb(dataUrl, cb){
    const img = new Image();
    img.onload = ()=>{
      const w = 320, h = Math.round(320 * img.height / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
  }

  // ============================================================
  // AI analysis — bring-your-own Anthropic API key, used only in owner mode,
  // sent directly from this browser to Anthropic for a single request.
  // ============================================================
  function dataUrlToMediaAndBase64(dataUrl){
    const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
    return {mediaType: m[1], base64: m[2]};
  }

  function buildPrompt(title, champ, notes){
    let ctx = 'You are reviewing screenshots from a League of Legends clip, in order, to coach the player shown.\n';
    if(title) ctx += 'Clip title: ' + title + '\n';
    if(champ) ctx += 'Champion / role: ' + champ + '\n';
    if(notes) ctx += "Player's own account: " + notes + '\n';
    ctx += '\nLook at positioning, wave/lane management, cooldowns, itemization, vision, map awareness, and fight selection. Cite what is actually visible (minimap, HP bars, ability icons, item build, gold/CS) rather than guessing.\n\n';
    ctx += 'Respond with ONLY raw JSON, no markdown fences, matching exactly:\n';
    ctx += '{"summary": string, "priority_fix": string, "mistakes": [{"title": string, "moment": string, "what_happened": string, "why_it_mattered": string, "better_play": string}], "good_calls": [{"title": string, "moment": string, "what_happened": string}]}\n';
    ctx += 'summary: 2-3 direct sentences. priority_fix: one sentence, the single highest-leverage fix. mistakes: up to 5, ordered by importance. good_calls: 0-3, can be empty. If nothing clearly wrong is visible, say so in summary and return an empty mistakes array rather than inventing issues.';
    return ctx;
  }

  async function callClaude(frames, title, champ, notes, apiKey){
    const content = [];
    frames.forEach((fr,i)=>{
      const {mediaType, base64} = dataUrlToMediaAndBase64(fr.dataUrl);
      content.push({type:'text', text:'Frame '+(i+1)+' ('+fr.label+'):'});
      content.push({type:'image', source:{type:'base64', media_type: mediaType, data: base64}});
    });
    content.push({type:'text', text: buildPrompt(title, champ, notes)});

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({model:'claude-sonnet-5', max_tokens:1200, messages:[{role:'user', content}]})
    });
    if(!response.ok){
      const errBody = await response.json().catch(()=>({}));
      throw new Error((errBody.error && errBody.error.message) || ('Request failed (' + response.status + ')'));
    }
    const data = await response.json();
    const text = (data.content||[]).map(b=>b.text||'').join('\n').trim();
    const cleaned = text.replace(/^```json/i,'').replace(/^```/,'').replace(/```$/,'').trim();
    return JSON.parse(cleaned);
  }

  const publishError = document.getElementById('publishError');
  const managePanel = document.getElementById('managePanel');

  analyzeBtn.addEventListener('click', async ()=>{
    publishError.style.display = 'none';
    if(state.frames.length===0 || !ownerToken) return;
    const title = document.getElementById('titleInput').value.trim() || 'Untitled clip';
    const champ = document.getElementById('champInput').value.trim();
    const notes = document.getElementById('notesInput').value.trim();
    const videoUrl = normalizeGithubUrl(document.getElementById('githubUrl').value.trim());
    const apiKey = document.getElementById('anthropicKeyInput').value.trim();
    if(!apiKey){
      publishError.textContent = 'Paste an Anthropic API key first — it\'s only used for this one request.';
      publishError.style.display = 'block';
      return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing…';
    try{
      const result = await callClaude(state.frames, title, champ, notes, apiKey);
      makeThumb(state.frames[0].dataUrl, async (thumb)=>{
        try{
          const { sha, clips } = await fetchClipsForWrite();
          const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
          const record = { id, title, champ, notes, videoUrl, thumb, result, publishedAt: Date.now() };
          clips.push(record);
          await saveClips(clips, sha, 'Publish clip: ' + title);

          state.frames = []; renderFilmstrip();
          document.getElementById('titleInput').value = '';
          document.getElementById('champInput').value = '';
          document.getElementById('notesInput').value = '';
          document.getElementById('githubUrl').value = '';
          document.getElementById('anthropicKeyInput').value = '';
          videoShell.innerHTML = '<div class="video-empty">No clip loaded yet</div>';
          captureRow.style.display = 'none';
          state.videoEl = null;
          publishError.textContent = 'Published. It can take a little while to show below while GitHub updates the raw file.';
          publishError.style.display = 'block';
          publishError.style.borderColor = 'var(--good)';
          setTimeout(loadGallery, 3000);
          renderManageList();
        }catch(err){
          publishError.textContent = 'Analyzed, but publishing to GitHub failed: ' + err.message;
          publishError.style.display = 'block';
        }finally{
          analyzeBtn.disabled = state.frames.length===0;
          analyzeBtn.textContent = 'Analyze & publish';
        }
      });
    }catch(err){
      publishError.textContent = 'Analysis failed: ' + err.message;
      publishError.style.display = 'block';
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze & publish';
    }
  });

  // ---------- manage list (owner) ----------
  async function renderManageList(){
    const list = document.getElementById('manageList');
    try{
      const { clips } = await fetchClipsForWrite();
      if(clips.length===0){ managePanel.style.display='none'; return; }
      managePanel.style.display = 'block';
      list.innerHTML = '';
      clips.slice().sort((a,b)=>b.publishedAt-a.publishedAt).forEach(rec=>{
        const row = document.createElement('div');
        row.className = 'manage-row';
        row.innerHTML = '<div><div class="name">'+escapeHtml(rec.title)+'</div><div class="sub">'+new Date(rec.publishedAt).toLocaleString()+'</div></div>';
        const del = document.createElement('button');
        del.className = 'btn small danger-outline';
        del.textContent = 'Remove';
        del.addEventListener('click', async ()=>{
          if(!confirm('Remove "'+rec.title+'" from the showcase?')) return;
          try{
            const { sha, clips: current } = await fetchClipsForWrite();
            const next = current.filter(c=>c.id !== rec.id);
            await saveClips(next, sha, 'Remove clip: ' + rec.title);
            renderManageList();
            setTimeout(loadGallery, 3000);
          }catch(e){ alert('Could not remove it: ' + e.message); }
        });
        row.appendChild(del);
        list.appendChild(row);
      });
    }catch(err){
      managePanel.style.display = 'none';
    }
  }

  // ============================================================
  // Public gallery — reads straight from the raw file on GitHub, no auth needed.
  // ============================================================
  const galleryHost = document.getElementById('galleryHost');

  async function loadGallery(){
    try{
      const res = await fetch(RAW_DATA_URL + '?t=' + Date.now());
      if(!res.ok) throw new Error('status ' + res.status);
      const clips = (await res.json()).slice().sort((a,b)=>b.publishedAt-a.publishedAt);
      if(clips.length===0){
        galleryHost.innerHTML = '<div class="empty-state">No clips published yet.</div>';
        return;
      }
      const grid = document.createElement('div');
      grid.className = 'gallery-grid';
      clips.forEach(rec=>{
        const card = document.createElement('div');
        card.className = 'clip-card';
        card.innerHTML =
          (rec.thumb ? '<img class="thumb" src="'+rec.thumb+'">' : '<div class="thumb-empty">No preview</div>') +
          '<div class="body">' +
            '<div class="title">'+escapeHtml(rec.title)+'</div>' +
            (rec.champ ? '<div class="champ">'+escapeHtml(rec.champ)+'</div>' : '') +
            '<div class="excerpt">'+escapeHtml((rec.result && rec.result.summary) || '')+'</div>' +
            '<div class="meta-row"><span>'+((rec.result && rec.result.mistakes) ? rec.result.mistakes.length : 0)+' issue(s) found</span><span>'+new Date(rec.publishedAt).toLocaleDateString()+'</span></div>' +
          '</div>';
        card.addEventListener('click', ()=>openModal(rec));
        grid.appendChild(card);
      });
      galleryHost.innerHTML = '';
      galleryHost.appendChild(grid);
    }catch(err){
      galleryHost.innerHTML = '<div class="empty-state">Couldn\'t load the showcase right now.</div>';
    }
  }

  function analysisHtml(result){
    let html = '<div class="summary-block">'+escapeHtml(result.summary||'')+'</div>';
    if(result.priority_fix){
      html += '<div class="priority-block"><span class="k">Fix this first</span>'+escapeHtml(result.priority_fix)+'</div>';
    }
    if(Array.isArray(result.mistakes) && result.mistakes.length){
      html += '<div class="items-group"><h3 class="section-title"><span class="dot danger"></span>What went wrong</h3>';
      result.mistakes.forEach(m=>{
        html += '<div class="item-card"><div class="title">'+escapeHtml(m.title)+'</div>';
        if(m.moment) html += '<div class="moment">'+escapeHtml(m.moment)+'</div>';
        if(m.what_happened) html += '<p>'+escapeHtml(m.what_happened)+'</p>';
        if(m.why_it_mattered) html += '<p>'+escapeHtml(m.why_it_mattered)+'</p>';
        if(m.better_play) html += '<p class="fix"><b>Instead: </b>'+escapeHtml(m.better_play)+'</p>';
        html += '</div>';
      });
      html += '</div>';
    }
    if(Array.isArray(result.good_calls) && result.good_calls.length){
      html += '<div class="items-group"><h3 class="section-title"><span class="dot good"></span>What worked</h3>';
      result.good_calls.forEach(g=>{
        html += '<div class="item-card good"><div class="title">'+escapeHtml(g.title)+'</div>';
        if(g.moment) html += '<div class="moment">'+escapeHtml(g.moment)+'</div>';
        if(g.what_happened) html += '<p>'+escapeHtml(g.what_happened)+'</p>';
        html += '</div>';
      });
      html += '</div>';
    }
    return html;
  }

  const modalHost = document.getElementById('modalHost');
  function openModal(rec){
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) close(); });
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<button class="modal-close">&times;</button>' +
      '<h3>'+escapeHtml(rec.title)+'</h3>' +
      (rec.champ ? '<span class="champ">'+escapeHtml(rec.champ)+'</span>' : '') +
      '<div class="video-shell"><video controls src="'+rec.videoUrl+'"></video></div>' +
      analysisHtml(rec.result);
    modal.querySelector('.modal-close').addEventListener('click', close);
    backdrop.appendChild(modal);
    modalHost.appendChild(backdrop);
    function close(){ modalHost.innerHTML = ''; }
  }

  loadGallery();
})();
