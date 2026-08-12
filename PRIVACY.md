# Privacy Policy — Music Studio

_Last updated: 2026-08-12_

Music Studio is a static web app. **There is no backend and no analytics.** The site is served as
plain files from GitHub Pages; nothing you create is transmitted to the author or to any server
operated by this project.

## What is stored, and where

| Data | Where it lives |
|---|---|
| Albums, groups, playlists, track prompts, settings | Your browser's IndexedDB, on your device |
| Your ElevenLabs API key | Your browser's IndexedDB, on your device |
| Generated and uploaded audio | Your browser's IndexedDB **and** the local folder you choose |
| Published albums (tracks + playlist) | The local "publish" folder you choose |

Folder access uses the browser's File System Access API and only ever reaches folders you explicitly
pick. You can clear everything at any time via your browser's site-data controls.

## Third parties

**ElevenLabs.** When you generate music or dialog, your prompt text and your API key are sent
directly from your browser to the ElevenLabs API to fulfil that request. This is governed by
[ElevenLabs' privacy policy](https://elevenlabs.io/privacy). The app estimates cost locally; no
billing data is collected by this app.

**Google Drive (optional).** If you enable the phone-remote feature, the app requests the
`drive.appdata` scope and signs you in with Google. This scope grants access **only to a private,
per-application folder in your own Drive** — it cannot see, read, or modify any other file in your
Drive. Two small JSON files are stored there:

- `musicstudio-catalog.json` — your album titles, descriptions, metadata and tracklists (text only)
- `musicstudio-requests.json` — which albums you ticked on your phone

**No audio is ever uploaded through the Google Drive API.** Access tokens are held in memory for the
session only and are never written to disk. Disconnecting in Settings drops the token; deleting the
files (or revoking access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions))
removes the data. Google's handling of your account data is governed by Google's own privacy policy.

Use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Children

This app is not directed to children under 13 and collects no personal information.

## Contact

Questions or requests: open an issue at
[github.com/adervec/MusicStudio](https://github.com/adervec/MusicStudio/issues).
