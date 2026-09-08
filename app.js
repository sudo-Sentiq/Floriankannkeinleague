(function(){
  const CONFIG = {
    OWNER_GITHUB_USERNAME: 'sudo-Sentiq', 
    REPO_OWNER: 'sudo-Sentiq',            
    REPO_NAME: 'Floriankannkeinleague',                
    BRANCH: 'main',                                    
    DATA_PATH: 'data/clips.json',
    SUBMISSION_LABEL: 'submission'
  };

  const RAW_DATA_URL = 'https://raw.githubusercontent.com/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/' + CONFIG.BRANCH + '/' + CONFIG.DATA_PATH;
  const CONTENTS_API_URL = 'https://api.github.com/repos/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/contents/' + CONFIG.DATA_PATH;
  const ISSUES_API_URL = 'https://api.github.com/repos/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/issues';

  document.getElementById('submitLink').href =
    'https://github.com/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/issues/new?template=submit-clip.yml';

  // in-memory only — never persisted, cleared on reload
  let ownerToken = null;

  const state = {
    frames: [], frameSeq: 0,
    videoEl: null, captureAllowed: false,
    pendingVideoType: null, pendingVideoSrc: null,
    currentSubmissionIssueNumber: null, currentSubmissionAuthor: null
  };

  // ---------- helpers ----------
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
  function isDataUrl(s){ return /^data:/.test(s||''); }
  function ghHeaders(extra){
    const h = { 'Accept':'application/vnd.github+json' };
    if(ownerToken) h['Authorization'] = 'Bearer ' + ownerToken;
    return Object.assign(h, extra||{});
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
    renderSubmissions();
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
    const res = await fetch(CONTENTS_API_URL + '?ref=' + CONFIG.BRANCH, { headers: ghHeaders() });
    if(res.status === 404) return { sha: null, clips: [] };
    if(!res.ok) throw new Error('Could not read current data (' + res.status + ')');
    const json = await res.json();
    let clips = [];
    try{ clips = JSON.parse(b64Decode(json.content.replace(/\n/g,''))); }catch(e){ clips = []; }
    return { sha: json.sha, clips };
  }

  async function saveClips(clips, sha, message){
    const body = { message, content: b64Encode(JSON.stringify(clips, null, 2)), branch: CONFIG.BRANCH };
    if(sha) body.sha = sha;
    const res = await fetch(CONTENTS_API_URL, {
      method: 'PUT',
      headers: ghHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    if(!res.ok){
      const errBody = await res.json().catch(()=>({}));
      throw new Error(errBody.message || ('GitHub rejected the write (' + res.status + ')'));
    }
  }

  // ============================================================
  // Submissions — public visitors file a GitHub issue via the issue form;
  // the owner reviews them here and pulls one into the composer.
  // ============================================================
  const submissionsPanel = document.getElementById('submissionsPanel');
  const submissionsList = document.getElementById('submissionsList');

  function parseIssueBody(body){
    const out = {};
    const parts = (body||'').split(/^### /m).slice(1);
    parts.forEach(p=>{
      const nl = p.indexOf('\n');
      if(nl === -1) return;
      const header = p.slice(0, nl).trim().toLowerCase();
      let content = p.slice(nl+1).trim();
      if(/^_no response_$/i.test(content)) content = '';
      if(/champion/.test(header)) out.champ = content;
      else if(/video/.test(header)) out.videoLink = content;
      else if(/notes/.test(header)) out.notes = content;
      else if(/title/.test(header)) out.title = content;
    });
    return out;
  }

  async function fetchSubmissions(){
    const res = await fetch(ISSUES_API_URL + '?labels=' + encodeURIComponent(CONFIG.SUBMISSION_LABEL) + '&state=open&per_page=50', { headers: ghHeaders() });
    if(!res.ok) throw new Error('status ' + res.status);
    const issues = await res.json();
    return issues.filter(i => !i.pull_request).map(iss => Object.assign(
      { number: iss.number, url: iss.html_url, author: iss.user && iss.user.login, issueTitle: iss.title },
      parseIssueBody(iss.body)
    ));
  }

  async function closeIssue(number){
    await fetch(ISSUES_API_URL + '/' + number, {
      method: 'PATCH',
      headers: ghHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ state: 'closed' })
    });
  }

  async function renderSubmissions(){
    try{
      const subs = await fetchSubmissions();
      if(subs.length === 0){ submissionsPanel.style.display = 'none'; return; }
      submissionsPanel.style.display = 'block';
      submissionsList.innerHTML = '';
      subs.forEach(sub=>{
        const row = document.createElement('div');
        row.className = 'manage-row';
        row.innerHTML =
          '<div>' +
            '<div class="name">'+escapeHtml(sub.title || sub.issueTitle)+'</div>' +
            '<div class="sub">from ' + escapeHtml(sub.author||'unknown') + (sub.champ ? ' · ' + escapeHtml(sub.champ) : '') + '</div>' +
            (sub.notes ? '<div class="snippet">'+escapeHtml(sub.notes.slice(0,160))+'</div>' : '') +
          '</div>';
        const actions = document.createElement('div');
        actions.className = 'actions';
        const reviewBtn = document.createElement('button');
        reviewBtn.className = 'btn small primary';
        reviewBtn.textContent = 'Review & publish';
        reviewBtn.addEventListener('click', ()=>loadSubmissionIntoComposer(sub));
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'btn small danger-outline';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', async ()=>{
          if(!confirm('Dismiss this submission without publishing?')) return;
          try{ await closeIssue(sub.number); renderSubmissions(); }
          catch(e){ alert('Could not dismiss it: ' + e.message); }
        });
        actions.appendChild(reviewBtn);
        actions.appendChild(dismissBtn);
        row.appendChild(actions);
        submissionsList.appendChild(row);
      });
    }catch(err){
      submissionsPanel.style.display = 'none';
    }
  }

  function loadSubmissionIntoComposer(sub){
    document.getElementById('titleInput').value = sub.title || sub.issueTitle || '';
    document.getElementById('champInput').value = sub.champ || '';
    document.getElementById('reviewInput').value = sub.notes ? ('Submitter\'s note: ' + sub.notes + '\n\n') : '';
    document.getElementById('videoLinkInput').value = sub.videoLink || '';
    state.currentSubmissionIssueNumber = sub.number;
    state.currentSubmissionAuthor = sub.author || null;
    if(sub.videoLink) loadVideoFromUrl(sub.videoLink);
    document.getElementById('composerPanel').scrollIntoView({ behavior: 'smooth' });
    refreshPublishEnabled();
  }

  // ============================================================
  // Video loading — direct files (GitHub raw, etc.) and embeds (YouTube, Twitch, Streamable)
  // ============================================================
  const videoShell = document.getElementById('videoShell');
  const captureRow = document.getElementById('captureRow');
  const timeLabel = document.getElementById('timeLabel');
  const loadError = document.getElementById('loadError');
  const embedNote = document.getElementById('embedNote');

  function fmtTime(sec){
    sec = Math.max(0, Math.floor(sec||0));
    return Math.floor(sec/60) + ':' + String(sec%60).padStart(2,'0');
  }

  function normalizeGithubUrl(url){
    const m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/);
    if(m) return 'https://raw.githubusercontent.com/'+m[1]+'/'+m[2]+'/'+m[3]+'/'+m[4];
    return url;
  }

  function parseEmbedUrl(url){
    let m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
    if(m) return { type:'youtube', embedSrc:'https://www.youtube.com/embed/'+m[1], thumb:'https://img.youtube.com/vi/'+m[1]+'/hqdefault.jpg' };
    m = url.match(/clips\.twitch\.tv\/([A-Za-z0-9_-]+)/) || url.match(/twitch\.tv\/[^\/]+\/clip\/([A-Za-z0-9_-]+)/);
    if(m) return { type:'twitch', embedSrc:'https://clips.twitch.tv/embed?clip='+m[1]+'&parent='+location.hostname };
    m = url.match(/twitch\.tv\/videos\/(\d+)/);
    if(m) return { type:'twitch-vod', embedSrc:'https://player.twitch.tv/?video='+m[1]+'&parent='+location.hostname };
    m = url.match(/streamable\.com\/([A-Za-z0-9]+)/);
    if(m) return { type:'streamable', embedSrc:'https://streamable.com/e/'+m[1] };
    return null;
  }

  function loadVideoFromUrl(rawUrl){
    loadError.style.display = 'none';
    const url = rawUrl.trim();
    if(!url) return;
    videoShell.innerHTML = '';
    state.videoEl = null;
    const embed = parseEmbedUrl(url);
    if(embed){
      const f = document.createElement('iframe');
      f.className = 'embed';
      f.src = embed.embedSrc;
      f.allow = 'autoplay; fullscreen';
      videoShell.appendChild(f);
      state.captureAllowed = false;
      state.pendingVideoType = 'embed';
      state.pendingVideoSrc = embed.embedSrc;
      captureRow.style.display = 'none';
      embedNote.style.display = 'block';
      if(embed.thumb && state.frames.length === 0) addFrame(embed.thumb, 'auto');
    } else {
      const direct = normalizeGithubUrl(url);
      const v = document.createElement('video');
      v.src = direct;
      v.controls = true;
      v.crossOrigin = 'anonymous';
      v.addEventListener('error', ()=>{
        loadError.textContent = "Couldn't load that link as a video. Double check it points straight at a file, or that it's a YouTube/Twitch/Streamable link.";
        loadError.style.display = 'block';
      });
      v.addEventListener('timeupdate', ()=>{ timeLabel.textContent = fmtTime(v.currentTime); });
      videoShell.appendChild(v);
      state.videoEl = v;
      state.captureAllowed = true;
      state.pendingVideoType = 'file';
      state.pendingVideoSrc = direct;
      captureRow.style.display = 'flex';
      embedNote.style.display = 'none';
    }
    refreshPublishEnabled();
  }

  document.getElementById('loadVideoBtn').addEventListener('click', ()=>{
    loadVideoFromUrl(document.getElementById('videoLinkInput').value);
  });

  // ---------- thumbnail & screenshots ----------
  const filmstrip = document.getElementById('filmstrip');

  function addFrame(dataUrl, label){
    state.frames.push({ id: ++state.frameSeq, dataUrl, label });
    renderFilmstrip();
  }
  function renderFilmstrip(){
    filmstrip.innerHTML = '';
    state.frames.forEach((fr, i)=>{
      const card = document.createElement('div');
      card.className = 'frame-card';
      card.innerHTML = '<img src="'+fr.dataUrl+'"><div class="tag">'+(i===0 ? 'thumb · ' : '')+fr.label+'</div><button class="remove">&times;</button>';
      card.querySelector('.remove').addEventListener('click', ()=>{
        state.frames = state.frames.filter(x=>x.id!==fr.id);
        renderFilmstrip();
      });
      filmstrip.appendChild(card);
    });
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
      loadError.textContent = "This link blocks in-browser frame capture (no CORS). Use a raw.githubusercontent.com link, or upload an image instead.";
      loadError.style.display = 'block';
    }
  });

  document.getElementById('pickImagesBtn').addEventListener('click', ()=>document.getElementById('imageFiles').click());
  document.getElementById('imageFiles').addEventListener('change', (e)=>{
    Array.from(e.target.files||[]).forEach(f=>{
      const reader = new FileReader();
      reader.onload = ()=> addFrame(reader.result, 'upload');
      reader.readAsDataURL(f);
    });
    e.target.value = '';
  });

  function resizeImage(dataUrl, width, cb){
    if(!isDataUrl(dataUrl)){ cb(dataUrl); return; } // external URL (e.g. auto YouTube thumb) — use as-is
    const img = new Image();
    img.onload = ()=>{
      const w = width, h = Math.round(width * img.height / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = ()=> cb(dataUrl);
    img.src = dataUrl;
  }

  // ============================================================
  // Publish — writes the owner's review straight to data/clips.json.
  // ============================================================
  const publishBtn = document.getElementById('publishBtn');
  const publishError = document.getElementById('publishError');
  const managePanel = document.getElementById('managePanel');
  const reviewInput = document.getElementById('reviewInput');

  function refreshPublishEnabled(){
    publishBtn.disabled = !(reviewInput.value.trim() && state.pendingVideoSrc);
  }
  reviewInput.addEventListener('input', refreshPublishEnabled);
  refreshPublishEnabled();

  function resetComposer(){
    state.frames = []; renderFilmstrip();
    state.videoEl = null; state.pendingVideoType = null; state.pendingVideoSrc = null;
    state.currentSubmissionIssueNumber = null; state.currentSubmissionAuthor = null;
    document.getElementById('titleInput').value = '';
    document.getElementById('champInput').value = '';
    reviewInput.value = '';
    document.getElementById('videoLinkInput').value = '';
    videoShell.innerHTML = '<div class="video-empty">No clip loaded yet</div>';
    captureRow.style.display = 'none';
    embedNote.style.display = 'none';
  }

  publishBtn.addEventListener('click', async ()=>{
    publishError.style.display = 'none';
    publishError.style.borderColor = '';
    if(!ownerToken || !state.pendingVideoSrc) return;
    const title = document.getElementById('titleInput').value.trim() || 'Untitled clip';
    const champ = document.getElementById('champInput').value.trim();
    const review = reviewInput.value.trim();
    if(!review){
      publishError.textContent = 'Write a review before publishing.';
      publishError.style.display = 'block';
      return;
    }

    publishBtn.disabled = true;
    publishBtn.textContent = 'Publishing…';

    const finish = async (thumb, screenshots)=>{
      try{
        const { sha, clips } = await fetchClipsForWrite();
        const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
        const record = {
          id, title, champ, review,
          videoType: state.pendingVideoType, videoSrc: state.pendingVideoSrc,
          thumb, screenshots, publishedAt: Date.now()
        };
        if(state.currentSubmissionAuthor) record.submittedBy = state.currentSubmissionAuthor;
        clips.push(record);
        await saveClips(clips, sha, 'Publish clip: ' + title);

        if(state.currentSubmissionIssueNumber){
          await closeIssue(state.currentSubmissionIssueNumber).catch(()=>{});
        }

        resetComposer();
        publishError.textContent = 'Published. It can take a little while to show below while GitHub updates the raw file.';
        publishError.style.display = 'block';
        publishError.style.borderColor = 'var(--good)';
        setTimeout(loadGallery, 3000);
        renderManageList();
        renderSubmissions();
      }catch(err){
        publishError.textContent = 'Publishing to GitHub failed: ' + err.message;
        publishError.style.display = 'block';
      }finally{
        refreshPublishEnabled();
        publishBtn.textContent = 'Publish clip';
      }
    };

    if(state.frames.length === 0){
      finish(null, []);
    } else {
      resizeImage(state.frames[0].dataUrl, 320, (thumb)=>{
        const rest = state.frames.slice(1);
        if(rest.length === 0){ finish(thumb, []); return; }
        Promise.all(rest.map(fr => new Promise(resolve => resizeImage(fr.dataUrl, 480, resolve))))
          .then(screenshots => finish(thumb, screenshots));
      });
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
        row.innerHTML = '<div><div class="name">'+escapeHtml(rec.title)+'</div><div class="sub">'+new Date(rec.publishedAt).toLocaleString()+(rec.submittedBy ? ' · submitted by '+escapeHtml(rec.submittedBy) : '')+'</div></div>';
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
        const excerpt = (rec.review||'').slice(0, 140) + ((rec.review||'').length > 140 ? '…' : '');
        card.innerHTML =
          (rec.thumb ? '<img class="thumb" src="'+rec.thumb+'">' : '<div class="thumb-empty">No preview</div>') +
          '<div class="body">' +
            '<div class="title">'+escapeHtml(rec.title)+'</div>' +
            (rec.champ ? '<div class="champ">'+escapeHtml(rec.champ)+'</div>' : '') +
            '<div class="excerpt">'+escapeHtml(excerpt)+'</div>' +
            '<div class="meta-row"><span>review</span><span>'+new Date(rec.publishedAt).toLocaleDateString()+'</span></div>' +
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

  function reviewHtml(rec){
    let html = '<div class="summary-block">';
    escapeHtml(rec.review).split(/\n+/).forEach(line=>{
      if(line.trim()) html += '<p style="margin:0 0 10px;">'+line+'</p>';
    });
    html += '</div>';
    if(Array.isArray(rec.screenshots) && rec.screenshots.length){
      html += '<div class="items-group"><h3 class="section-title"><span class="dot"></span>Moments referenced</h3>';
      html += '<div class="filmstrip" style="padding-left:0;">';
      rec.screenshots.forEach(src=>{
        html += '<div class="frame-card" style="width:150px;"><img src="'+src+'" style="height:90px;"></div>';
      });
      html += '</div></div>';
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
    const mediaHtml = rec.videoType === 'embed'
      ? '<iframe class="embed" src="'+rec.videoSrc+'" allow="autoplay; fullscreen"></iframe>'
      : '<video controls src="'+rec.videoSrc+'"></video>';
    modal.innerHTML =
      '<button class="modal-close">&times;</button>' +
      '<h3>'+escapeHtml(rec.title)+'</h3>' +
      (rec.champ ? '<span class="champ">'+escapeHtml(rec.champ)+'</span>' : '') +
      '<div class="video-shell">'+mediaHtml+'</div>' +
      reviewHtml(rec);
    modal.querySelector('.modal-close').addEventListener('click', close);
    backdrop.appendChild(modal);
    modalHost.appendChild(backdrop);
    function close(){ modalHost.innerHTML = ''; }
  }

  loadGallery();
})();
