import { Post } from '../types';

export type OfflineSearchOptions = {
  maxResults?: number;
  minScore?: number;
};

type SearchCandidate = {
  post: Post;
  normalizedQuery: string;
  queryTokens: string[];
  title: string;
  summary: string;
  tags: string[];
  transcript: string;
  metadata: string;
  allText: string;
  allTokens: string[];
};

const MIN_TOKEN_LENGTH = 2;
const DEFAULT_MIN_SCORE = 1;

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#_/-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: unknown): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(' ')
    .filter(token => token.length >= MIN_TOKEN_LENGTH);
}

function uniqueTokens(values: string[]): string[] {
  return Array.from(new Set(values));
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[b.length];
}

function tokenMatches(queryToken: string, candidateToken: string): boolean {
  if (candidateToken === queryToken) {
    return true;
  }

  if (candidateToken.startsWith(queryToken) || candidateToken.includes(queryToken)) {
    return true;
  }

  if (queryToken.length >= 4 && candidateToken.length >= 4) {
    const maxDistance = queryToken.length >= 7 ? 2 : 1;
    return boundedLevenshtein(queryToken, candidateToken, maxDistance) <= maxDistance;
  }

  return false;
}

function getTranscriptText(post: Post): string {
  return [
    post.audio_transcription,
    post.transcribed_text,
    post.transcript,
    post.transcription,
    post.text_analysis,
  ].filter(Boolean).join(' ');
}

function buildCandidate(post: Post, normalizedQuery: string, queryTokens: string[]): SearchCandidate {
  const title = normalizeText(post.title);
  const summary = normalizeText(post.summary);
  const tags = (post.tags || []).map(normalizeText).filter(Boolean);
  const transcript = normalizeText(getTranscriptText(post));
  const metadata = normalizeText([
    post.category,
    post.music,
    post.username,
    post.shortcode,
  ].filter(Boolean).join(' '));
  const allTokens = uniqueTokens([
    ...tokenize(title),
    ...tokenize(summary),
    ...tags.flatMap(tokenize),
    ...tokenize(transcript),
    ...tokenize(metadata),
  ]);

  return {
    post,
    normalizedQuery,
    queryTokens,
    title,
    summary,
    tags,
    transcript,
    metadata,
    allText: [title, summary, tags.join(' '), transcript, metadata].join(' '),
    allTokens,
  };
}

function scoreCandidate(candidate: SearchCandidate): number {
  const {
    normalizedQuery,
    queryTokens,
    title,
    summary,
    tags,
    transcript,
    metadata,
    allText,
    allTokens,
  } = candidate;

  if (!normalizedQuery || queryTokens.length === 0) {
    return 1;
  }

  let score = 0;

  if (title.includes(normalizedQuery)) score += 60;
  if (summary.includes(normalizedQuery)) score += 42;
  if (transcript.includes(normalizedQuery)) score += 34;
  if (tags.some(tag => tag.includes(normalizedQuery))) score += 50;
  if (metadata.includes(normalizedQuery)) score += 20;

  for (const queryToken of queryTokens) {
    let tokenScore = 0;

    if (tags.some(tag => tag === queryToken || tag.includes(queryToken))) {
      tokenScore = Math.max(tokenScore, 18);
    }
    if (title.split(' ').some(token => tokenMatches(queryToken, token))) {
      tokenScore = Math.max(tokenScore, 16);
    }
    if (summary.split(' ').some(token => tokenMatches(queryToken, token))) {
      tokenScore = Math.max(tokenScore, 12);
    }
    if (transcript.split(' ').some(token => tokenMatches(queryToken, token))) {
      tokenScore = Math.max(tokenScore, 10);
    }
    if (metadata.split(' ').some(token => tokenMatches(queryToken, token))) {
      tokenScore = Math.max(tokenScore, 6);
    }
    if (tokenScore === 0 && allTokens.some(token => tokenMatches(queryToken, token))) {
      tokenScore = 4;
    }

    if (tokenScore === 0 && allText.includes(queryToken)) {
      tokenScore = 3;
    }

    score += tokenScore;
  }

  return score;
}

export function searchPostsOffline(
  posts: Post[],
  query: string,
  options: OfflineSearchOptions = {},
): Post[] {
  const normalizedQuery = normalizeText(query);
  const queryTokens = uniqueTokens(tokenize(normalizedQuery));

  if (!normalizedQuery || queryTokens.length === 0) {
    return posts;
  }

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

  const matches = posts
    .map(post => {
      const candidate = buildCandidate(post, normalizedQuery, queryTokens);
      return { post, score: scoreCandidate(candidate) };
    })
    .filter(result => result.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const aDate = Date.parse(a.post.analyzed_at || a.post.post_date || '') || 0;
      const bDate = Date.parse(b.post.analyzed_at || b.post.post_date || '') || 0;
      return bDate - aDate;
    });

  return typeof options.maxResults === 'number'
    ? matches.slice(0, options.maxResults).map(result => result.post)
    : matches.map(result => result.post);
}

export function postMatchesOfflineQuery(post: Post, query: string): boolean {
  return searchPostsOffline([post], query).length > 0;
}
