# The Explorer — online flipbook

Shows a PDF magazine as a page-turning flipbook in any web browser, on desktop,
laptop, tablet and phone. Readers can flip pages, zoom in, jump to any page from
a thumbnail list, and download the original PDF.

It is built from two free, open-source libraries and needs no licence, no
account, no subscription and no internet service. Everything it uses is inside
this folder.

---

> **Currently published:** *The Explorer 2025*, a previously released edition
> (106 pages). Unreleased drafts must not be committed — drop them in `assets/`
> under any name but `document.pdf` and git will ignore them. See "Previewing a
> draft" below, and "Sharing a draft with reviewers" to put one online behind a
> login.

## Publishing a new edition

**Replace one file: `assets/document.pdf`.**

That is the whole job. There is nothing to rebuild and no code to edit. The
viewer reads the PDF when someone opens the page, so it works out the number of
pages, the page shape, the thumbnails and the contents shortcut on its own.

### On GitHub

1. Open the repository on github.com and click into the `assets` folder.
2. Click **Add file › Upload files**.
3. Drag the new PDF in. **Rename it to `document.pdf` first**, so it replaces
   the old one instead of sitting alongside it.
4. Click **Commit changes**.

The site updates within a minute or two.

### On a web server or intranet

Copy the new PDF over the top of `assets/document.pdf`, keeping the file name
exactly the same.

### Previewing a draft without publishing it

**Every PDF in `assets/` except the released `document.pdf` is ignored by git**,
whatever you name it, so a draft can sit safely next to the published edition and
cannot be committed by accident. To preview one:

1. Put it in `assets/` — any name will do, e.g. `assets/explorer-2026-draft1.pdf`.
2. Open `http://localhost:8000/?pdf=assets/explorer-2026-draft1.pdf`.

The viewer behaves identically; only the file it reads changes. This is the
right way to check a new edition before it is cleared for release.

### Sharing a draft with reviewers

Reviewers who are not sitting at this computer need the draft on the web, which
the public GitHub Pages site cannot do — that site, and this repository, are
readable by anyone. `deploy-draft.sh` puts the draft on a **separate Cloudflare
Pages site behind a login**, and uploads it directly, so the draft never enters
git history.

```sh
./deploy-draft.sh                            # deploys the current draft
./deploy-draft.sh 'assets/another draft.pdf' # a specific draft (quote spaces)
```

The default is set by the `DRAFT` line near the top of `deploy-draft.sh` — point
it at the newest draft when one supersedes another.

**First time only**, three steps in the Cloudflare dashboard:

1. Sign in (a free account is enough) and run the script once. It will prompt
   you to authorise `wrangler` in the browser, then create the project and print
   a `https://<project>.pages.dev` URL.
2. Go to **Zero Trust › Access › Applications** and add a *self-hosted*
   application for that hostname.
3. Give it a policy that **allows** the *emails* of your reviewers. Cloudflare
   emails each of them a one-time code to log in — they do not need accounts.

After that, every later draft is one command; the policy stays in place. To add
or drop a reviewer, edit the email list in that policy.

> **The gate is not on until step 3 is finished.** Between the first deploy and
> the policy being saved, anyone with the URL can read the draft, so do not send
> the link until you have tested it yourself in a private window and been asked
> to log in.

Free-plan limits are generous but not unlimited (Cloudflare Access covers a
small reviewer list at no cost); check current pricing if your list grows past a
few dozen people.

### A note on names

The file must be called `document.pdf`. If you would rather keep the original
long file name, put the PDF in `assets/` and change the `pdfPath` line in
`config.js` to match — but replacing `document.pdf` is simpler and less likely
to go wrong.

Readers will not be served a stale copy. The viewer checks with the server
whether the file has changed and fetches the new one automatically.

---

## Changing the title or the download link

Open `config.js` in Notepad or TextEdit. It is plain text and the comments
explain each line.

| Setting | What it does |
|---|---|
| `title` | The name shown in the toolbar and the browser tab. |
| `pdfPath` | Which file to display. Leave as `assets/document.pdf`. |
| `downloadUrl` | Leave blank to let readers download the PDF above. Paste a Google Drive share link to send them there instead. |
| `maxRenderScale` | Page sharpness. `2` suits almost everything. Raise to `3` only if pages look soft on a very large monitor. |

Keep the quotation marks, colons and commas where they are.

---

## Putting it online

### GitHub Pages

Push this folder to a GitHub repository, then in the repository go to
**Settings › Pages** and set the source to the `main` branch, root folder. The
site appears at `https://<your-username>.github.io/<repository-name>/`.

### Your own web server

Copy the whole folder up as-is, anywhere the server publishes files. That is the
entire deployment. Specifically:

- **No install, no build, no runtime.** There is no Node, PHP, Python or database
  involved. Every file is static; the browser does all the work.
- **No server configuration.** Only ordinary `.html`, `.css`, `.js`, `.pdf` and
  `.svg` files are used, which every web server already serves correctly.
- **Any location works.** All links are relative, so the root of a domain, a
  subfolder, or a virtual directory are all fine, with no changes.

Optional tidying: `.nojekyll` is only meaningful on GitHub Pages, and
`package.json` / `package-lock.json` are just a record of which library versions
were vendored. Deleting all three changes nothing. Keeping them is harmless.

#### Checking it worked

Open the site and confirm the cover appears and pages turn. If you get a **blank
page**, open the browser console (**F12**) — it will name the file it could not
load, which is nearly always a permissions or path problem rather than anything
in the viewer.

Then check a phone on the same network, since that is where the file size of the
PDF is felt most.

#### If your server is locked down

Two things the viewer needs, both of which are default behaviour everywhere:

| Requirement | Why | If it is blocked |
|---|---|---|
| Serve `.js` as JavaScript | The viewer is ES modules | Universally mapped; nothing to do |
| Allow `HEAD` requests | Used to detect a replaced PDF and bypass browser caches | Falls back automatically; readers may need to force-refresh after a new edition is uploaded |

Byte-range requests are used if available, so a large PDF starts displaying
before it has fully downloaded. If your server does not support them the whole
file is fetched first instead — slower to first page, but it still works.

### One important limitation

**It must be opened through a web server, not by double-clicking `index.html`.**

Browsers refuse to let a page read files from your hard disk this way, so
opening the file directly shows a message explaining the problem rather than the
magazine. Any web address starting `http://` or `https://` is fine.

If you want to check the folder on your own machine before uploading, open a
terminal in this folder and run:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

Note that SharePoint document libraries often serve uploaded HTML as a download
instead of displaying it. If SharePoint is the intended home, test it with a
small file before relying on it.

---

## What readers can do

| Action | How |
|---|---|
| Turn the page | Drag the corner of a page, click the page edge, or use the arrows at the bottom |
| Keyboard | `←` `→` or `Page Up` / `Page Down`; `Home` and `End` for the first and last page; `f` for full screen |
| Zoom | Double-tap or double-click a page. Then pinch, scroll, or use `+` / `−`. Drag to move around |
| Jump to a page | Open the menu (top left) for thumbnails, or type a page number in the box at the bottom |
| Contents | The list button in the toolbar jumps to the magazine's own contents page |
| Download | The download arrow gives them the original PDF |

Sharing a link to a particular page works: `...?page=42` opens on page 42, and
the address bar keeps up as the reader turns pages.

---

## What is inside

| Path | Purpose |
|---|---|
| `index.html` | The page itself |
| `config.js` | Settings — the only file you may need to edit |
| `assets/document.pdf` | The magazine |
| `css/flipbook.css` | Appearance |
| `js/` | The viewer's code, one file per job |
| `vendor/` | The two open-source libraries, with their licences |

### The libraries

| Library | Job | Licence |
|---|---|---|
| [pdf.js](https://mozilla.github.io/pdf.js/) 6.2.108 (Mozilla) | Reads the PDF and draws the pages | Apache 2.0 |
| [StPageFlip](https://github.com/Nodlik/StPageFlip) 2.0.7 | The page-turning effect | MIT |

Both are stored in `vendor/` rather than loaded from the internet, so the viewer
keeps working regardless of anyone else's website, and it makes no external
requests at all.

`package.json` records which versions were used. It is not needed to run the
viewer, and there is no build step.

---

## Design notes

A few decisions worth knowing if you or a colleague come back to this later.

**Why the PDF is not read from Google Drive.** Google Drive does not send the
`Access-Control-Allow-Origin` header, so browsers block any web page from
reading files stored there. This is a Google restriction, not something that can
be configured or worked around from this end, and it applies to every flipbook
tool, not just this one. The PDF therefore has to sit next to the viewer. Drive
is still a fine place to keep the master copy, and `downloadUrl` in `config.js`
can point readers at it.

**Why not turn.js.** It is the library most tutorials recommend, but its licence
forbids commercial use and it has had no updates in over twelve years.
StPageFlip is MIT-licensed and maintained.

**Why only a few pages are drawn at a time.** A rendered A4 page uses several
megabytes of memory, so drawing all 106 at once would ask the browser for
hundreds of megabytes. iPhones and iPads silently show blank pages when they run
out. The viewer therefore keeps only the pages near the reader in memory and
releases the rest. This is why page count barely affects how well it runs.

**There is no text search or text selection.** Both were built and then removed:
they depended on a transparent text layer over each page, and StPageFlip claims
the same mouse events to drive the page-turn gesture, which made the two
unreliable together. Readers who need to search or copy text can use the
download button and their own PDF reader, which does both properly. Removing the
text layer also cut a good deal of per-page DOM work.
