# Table for Two

A private gastronomic journal for Stefan and Marleen: every starred evening (and a few unstarred ones) we've shared.

The app is a web app that you add to the iPhone Home Screen. Its code lives in this repository and is published with GitHub Pages. **Your journal (entries and photos) is kept in a separate private repository**, so nothing personal ends up in this public one.

## One-time setup

1. **Create the private data repository.** On GitHub, create a new repository named `table-for-two-data` and set it to **Private**. Leave it empty.
2. **Turn on GitHub Pages for this repository.** Go to Settings → Pages → Build and deployment, choose "Deploy from a branch", then branch `main` and folder `/ (root)`. A minute later the app is live at
   `https://stefan-verstraeten.github.io/table-for-two/`
3. **Create an access key (one for each phone).** On github.com: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
   - Repository access: *Only select repositories* → `table-for-two-data`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Expiration: the longest you're comfortable with. When it expires, make a new one and paste it in the app's **You** tab.
4. **Install it on each iPhone.** Open the address in **Safari**, tap Share → *Add to Home Screen*, then launch it from the Home Screen icon. Pick Stefan or Marleen and paste that phone's access key.
   Do this from the Home Screen icon, not from Safari, because iOS keeps the two separate.

## How it works

- **Data**: everything is in `journal.json` plus a `photos/` folder in the data repository. Photos are stored at up to 2000 px, with a 640 px thumbnail. Each save is a commit, so you have a full history and can always download it.
- **Sync**: each phone keeps its own copy and works offline. When there is a connection it merges field by field, so if Stefan writes the memories while Marleen adds her rating, both are kept.
- **Photo metadata**: when you add photos, the app reads the date and GPS location. It offers that date and the restaurants nearby (via OpenStreetMap), and you confirm or change them.
- **Updates**: after a new version is published, the phones show *"A new version of Table for Two is ready — Update"*.

## Releasing a change

```bash
python3 tools/bump.py   # new version number + refresh the offline file list
git commit -am "…" && git push
```
