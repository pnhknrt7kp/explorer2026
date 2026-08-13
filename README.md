# The Explorer — online flipbook

Shows a PDF magazine as a page-turning flipbook in any web browser, on desktop,
laptop, tablet and phone. Readers can flip pages, zoom in, jump to any page from
a thumbnail list, and download the original PDF.

It is built from two free, open-source libraries and needs no licence, no
account, no subscription and no internet service. Everything it uses is inside
this folder.

---

> **Currently published:** *The Explorer 2025*, a previously released edition
> (106 pages). Unreleased drafts must not be committed — keep them as
> `*.local.pdf`, which git ignores. See "Previewing a draft" below.

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

Anything named `*.local.pdf` is ignored by git and can never be committed by
accident. So a draft can sit safely next to the placeholder:

1. Put it at `assets/document.local.pdf`.
2. Open `http://localhost:8000/?pdf=assets/document.local.pdf`.

The viewer behaves identically; only the file it reads changes. This is the
right way to check a new edition before it is cleared for release.

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

### Any other web server

Copy the whole folder up as-is. It uses only relative links, so it works at the
root of a domain or in a subfolder without changes. Nothing needs installing on
the server.

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
