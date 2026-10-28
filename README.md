# वीडियो पाठशाला · बस्ती

A light video page for schools in Basti. Teachers pick their block and school once, then play TicTacLearn Hindi
playlists inside the page. Every play is recorded in a Google Sheet so the district can see which schools are
using it, what they played, when, and for how long.

```
web/        the teacher page (plain HTML/CSS/JS, ~30 KB, no build step); host it anywhere static over HTTPS
backend/    Google Apps Script bound to the monitoring Google Sheet (API + dashboard)
dev/        local mock server for testing the page without Google
```

## How it works

- **Page → Sheet.** After 30 seconds of a video actually playing, the page sends a small record (school, video,
  start time, seconds watched). It updates that record every 3 minutes and when the video pauses or ends.
  Records wait on the device when offline and go out when the connection returns.
- **Watched time is measured from the video's own clock**, so skipping ahead or leaving a paused video open does
  not add time. The server also caps every record at the real time that passed between its start and its last update.
- **Teachers see their own activity**: a line under the header ("आज इस डिवाइस पर: 3 वीडियो · 42 मिनट"), a ✓ with
  the date on every video already played, and how many were played in each playlist.
- **Every 15 minutes** the script folds the raw `Log` into one row per play (`Sessions`) and rebuilds the dashboard tabs.

### Dashboard tabs (in the Google Sheet)

| Tab | Shows |
|---|---|
| Blocks | per block: schools, active today, active in 7 days, never used, minutes |
| Schools activity | every school, least active first within each block |
| Inactive | schools with no play in the last `INACTIVE_DAYS` days |
| Videos played | most played videos, how many schools, % watched to the end |
| Daily | schools active, videos and minutes per day |
| Flags | plays the server checks marked for a look |

### Server checks (flags)

Flags never block a teacher; they only point at rows worth a second look.

| Flag | Meaning |
|---|---|
| off-hours | started outside `SCHOOL_START`–`SCHOOL_END` or on an `OFF_DAYS` day |
| time over-reported | the device reported more watching than time actually passed (credited time is capped) |
| overlapping plays | one device playing two videos at the same time |
| device used by several schools | the same device recorded plays for two schools on one day |
| mostly muted / screen hidden | more than half the watched time was muted, or the page was in the background |
| device clock wrong | device clock off by more than 15 min (times in the sheet are already corrected) |
| unknown school | school code not in the `Schools` tab |

## Setup (about 20 minutes, once)

### 1. Create the Sheet and script

Either with clasp (installed on this machine):

```powershell
cd backend
Copy-Item appsscript.json appsscript.keep
clasp create --type sheets --title "Video Pathshala Monitoring" --rootDir .
Move-Item appsscript.keep appsscript.json -Force
clasp push
```

(`clasp create` writes a blank `appsscript.json`; the copy/move puts ours back, which turns on the YouTube service.)

Or by hand: create a Google Sheet → **Extensions → Apps Script** → create `Code.gs`, `Catalog.gs`, `Reports.gs`
with this folder's contents → **Project Settings → Show "appsscript.json"** and paste `appsscript.json`.

### 2. Run first-time setup

Reload the Sheet. Menu **Video Pathshala → First-time setup** and approve the permissions. This creates the tabs,
fills `Playlists` and `Videos` from the YouTube channel (about a minute), and adds the timers
(dashboard every 15 min, playlists daily at 3 am).

### 3. Add the real school list

In the `Schools` tab, delete the `SAMPLE` rows and paste the master list: `udise`, `block`, `school_name`.
Keep the block names spelled the same for all schools of a block; the page groups by them.

### 4. Choose what teachers see

In `Playlists`: `show` (TRUE/FALSE), `category` (the tabs on the page), `order` and `display_title` can be edited.
Defaults: Classes 9–10 and promotional lists are hidden. Edits reach teachers within a few minutes and survive
the daily refresh.

### 5. Deploy the API

In the Apps Script editor: **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*.
Copy the URL ending in `/exec` into `web/config.js`:

```js
api: 'https://script.google.com/macros/s/XXXX/exec',
```

After changing backend code later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

### 6. Host the page

Upload the `web/` folder to any static HTTPS host (GitHub Pages, Netlify, Hostinger). Share that link with schools.
Share the Google Sheet (view only) with the officer.

## Testing locally

```bash
node dev/mock-server.js
```

Open http://localhost:8787. The mock serves sample schools and real videos, and prints every record the page sends.

## Limits worth knowing

- **Capacity.** Apps Script handles each record as one row append, and the page sends about 3 records per
  video, so district-wide use is well within limits. The `Sessions` tab grows by one row per play; at full
  use (2,500 schools × 5 videos a day) a Sheet holds about two months. To start fresh, move old rows into
  another file.
- **YouTube's own controls stay visible.** The player's YouTube logo can still open youtube.com if tapped.
  Covering it breaks YouTube's embedding terms, so it is left alone.
- **What a record proves.** A record shows a video really played on a device that chose that school. It
  cannot show that children were watching; field visits remain the check for that.
