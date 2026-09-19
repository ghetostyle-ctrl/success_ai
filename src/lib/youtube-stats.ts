/**
 * YouTube Data API v3 stats fetcher.
 * Given a list of video IDs, returns stats per video.
 */

export type YouTubeStats = {
  id: string;
  title: string;
  channel: string;
  publishedAt: string; // YYYY-MM-DD
  views: number;
  likes: number;
  comments: number;
  durationSec: number;
  thumbnail: string;
  /** YouTube 영상 description — 광고 본문 카피로 활용 (ATC가 카피 텍스트
   * 노출 안 하므로 영상 광고는 이게 가장 가까운 카피). */
  description: string;
};

type YTVideoItem = {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    description?: string;
    thumbnails?: { medium?: { url: string }; default?: { url: string } };
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails: { duration: string };
};

function parseDurationSeconds(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + min * 60 + s;
}

export async function fetchYouTubeStats(
  videoIds: string[]
): Promise<YouTubeStats[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY not configured");
  if (videoIds.length === 0) return [];

  // Up to 50 IDs per request
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const all: YouTubeStats[] = [];
  for (const chunk of chunks) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,statistics,contentDetails");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`YouTube videos API failed (${res.status}): ${detail}`);
    }
    const data = (await res.json()) as { items: YTVideoItem[] };
    for (const v of data.items) {
      all.push({
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt.slice(0, 10),
        views: parseInt(v.statistics.viewCount ?? "0", 10),
        likes: parseInt(v.statistics.likeCount ?? "0", 10),
        comments: parseInt(v.statistics.commentCount ?? "0", 10),
        durationSec: parseDurationSeconds(v.contentDetails.duration),
        thumbnail:
          v.snippet.thumbnails?.medium?.url ??
          v.snippet.thumbnails?.default?.url ??
          "",
        // Description은 길 수 있음 (수천자). 광고 카피로 의미 있는 첫 부분
        // 만 보존 — 800자 cap. URL/CTA는 보통 끝에 있으니 잘라도 카피 손실 X.
        description: (v.snippet.description ?? "").slice(0, 800),
      });
    }
  }
  return all;
}
