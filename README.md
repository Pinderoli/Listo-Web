# Listo-Web

Make, reset, and share repeatable checklists — for hiking trips, business
travel, site safety checks, or anything you pack/prep the same way every
time.

- Create a list, organize it into sections (Clothes, Food, Documents, …),
  and add items.
- Check items off as you go. Hit **Reset** to uncheck everything for next
  time — no need to rebuild the list.
- **Export** a list to a `.listo.json` file to share it (AirDrop, email,
  etc.). Recipients **Import** it as their own copy.

No accounts, no backend — everything is saved locally in your browser.

## Running locally

It's a static site — just open `index.html` in a browser, or serve the
folder with any static file server, e.g.:

```
python3 -m http.server
```

## GitHub Pages

Settings → Pages → deploy from this branch, folder `/ (root)`.

## Roadmap

Deliberately not built yet: accounts, real-time collaboration, a
social/discovery feed of shared lists, native iOS/Android apps.
