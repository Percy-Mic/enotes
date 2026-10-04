# enotes licensed music

The video editor now has a **Popular music** provider adapter at:

- `GET /api/studio/music`
- `POST /api/studio/music/events`

The adapter is designed for a licensed catalog rather than scraping Spotify or CapCut.

## Feed Clips

The current adapter is for Feed Clips, which provides licensed major-label clips for UGC/short-form apps.

Add these Vercel environment variables after your Feed Clips onboarding:

```env
FEED_CLIPS_TOKEN=...
FEED_CLIPS_SECRET=...
FEED_CLIPS_COLLECTION_IDS=collection_id_1,collection_id_2
```

The collection IDs come from Feed Clips Studio. Do not expose the token/secret in client code.

The API returns short-lived signed URLs. enotes stores the provider clip ID in the project and refreshes the signed URL when the project is opened again.

## Important territory/licensing behavior

The catalog is provider-controlled. A song being visible in a provider catalog does not mean it is available in every territory or for every export/share workflow.

Feed.fm currently markets a global Feed Clips offering, but the exact catalog, territories, sharing and download rights are still controlled by the contract and collections enabled for the enotes account. The editor therefore treats provider playability as authoritative instead of assuming every song is globally available. Downloads of synced clips may also require direct rights-holder approval.

For the Philippines/OPM catalog, use a provider/rights deal that explicitly grants enotes the territory, synchronization, UGC, export and (if needed) commercial rights for the recordings and compositions. Do not substitute Spotify URLs or scrape CapCut.

## Fallback providers

Freesound, Jamendo and Coverr remain available for royalty-free/creator-library audio. They are separate from the licensed popular-music catalog.

## Event reporting

Feed events are proxied through `/api/studio/music/events` so credentials remain server-side. Preview, play and add events are wired into the editor. Share/download events can be enabled only after the provider contract permits those workflows.
