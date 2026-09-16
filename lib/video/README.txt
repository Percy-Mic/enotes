COPY THESE FILES INTO YOUR PROJECT:

app/studio/video/page.tsx       <- page.tsx
lib/video/project.ts            <- project.ts
lib/video/renderer.ts           <- renderer.ts

This version adds a CapCut-style multi-lane timeline model:
- sequential MAIN video track
- multiple overlay tracks
- drag main clips to reorder
- drag overlays between overlay tracks
- drag video overlays onto MAIN
- add/remove overlay tracks
- timeline snapping-ready structure
- existing trim/split/reverse/rotate/noise reduction/audio/effects retained
- video overlay preview uses cached HTMLVideoElement playback rather than image rendering

No new Supabase table is required for the editor tracks because tracks are stored in the existing video_projects.project JSON.
