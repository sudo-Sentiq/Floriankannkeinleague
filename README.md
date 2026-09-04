# Debrief

A GitHub-hosted clip showcase: only you can publish, everyone can browse, and publishing commits straight into this repo.

## How the security actually works

There's no server here — it's a static site on GitHub Pages — so "login" works differently than on a normal app:

- When you click **Owner sign in**, you paste a **GitHub personal access token**. The page sends it to `https://api.github.com/user` and asks GitHub who it belongs to. GitHub itself checks the token is valid — this page never invents or checks a password on its own.
- The page then checks that the returned username matches `OWNER_GITHUB_USERNAME` in `app.js`. That's the only thing this code decides.
- The part that's actually secure isn't that check — it's that **publishing a clip means committing a file to this repo through GitHub's API**, using your token. If someone without write access to the repo gets a copy of this site and pokes around in devtools, their attempts to publish will fail with a 403 from GitHub, because GitHub — not this website — is the one enforcing who can write to the repo.
- Your token is held in a JavaScript variable for the current browser tab only. It's never written to a file, localStorage, or the repo, and it disappears on refresh.

So: real authentication (GitHub validates the token) and real authorization (GitHub enforces repo write access) — this page is just a thin UI in front of both.

## One-time setup

1. **Create a repo** (public repos make the free tier of GitHub Pages simplest). Add all the files from this folder, keeping the `data/` subfolder.
2. **Edit the config** at the top of `app.js`:
   ```js
   OWNER_GITHUB_USERNAME: 'your-github-username',
   REPO_OWNER: 'your-github-username',
   REPO_NAME: 'your-repo-name',
   BRANCH: 'main',
   ```
3. Commit and push everything, including the empty `.nojekyll` file and `data/clips.json` (starts as `[]`).
4. In the repo, go to **Settings → Pages**, set the source to your branch (root), save. GitHub gives you a URL like `https://your-username.github.io/your-repo-name/`.
5. **Generate a token**: GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
   - Repository access: only this one repo.
   - Permissions: **Contents → Read and write**. Nothing else.
   - Set an expiration (30–90 days is reasonable — you'll generate a new one when it lapses).
   - Copy it somewhere safe; GitHub only shows it once. You'll paste it into the site each time you want to publish.

## Publishing a clip

1. Open your live site, click **Owner sign in**, paste the token.
2. Paste a link to a video file already committed in a GitHub repo (yours or otherwise) — either the normal `github.com/.../blob/...` link or a `raw.githubusercontent.com` link. Raw links are the ones that reliably allow in-browser frame capture.
3. Scrub to a moment and hit **Capture this frame** a few times, add a title/champion/notes.
4. Paste an **Anthropic API key** (from console.anthropic.com) — this is used once, directly from your browser, to call Claude for that single analysis. It is not saved anywhere, but it is visible in your browser's network tab while you're using it, so:
   - Use a key with a spending limit set.
   - Don't do this on a machine/browser you don't trust.
5. Hit **Analyze & publish**. This commits the updated `data/clips.json` to the repo. It can take anywhere from a few seconds to about a minute to show up in the showcase below, since it's reading the raw file straight from GitHub.

## Notes and limitations

- Visitors never need to sign in or hold any key — the showcase reads `data/clips.json` directly, which is just a public file in the repo.
- Removing a clip works the same way: it's a commit that deletes its entry from `data/clips.json`.
- This is intentionally simple (no build step, no dependencies) so it's easy to audit and easy to redeploy. If you outgrow it — e.g. you want to hide your Anthropic key entirely instead of pasting it each session — the next step up is a small serverless function (Cloudflare Worker, Vercel function, etc.) that holds the key server-side and you call instead of Anthropic directly. Happy to help build that when you're ready for it.
