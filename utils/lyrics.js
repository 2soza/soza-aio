const axios = require('axios');

const REQUEST_TIMEOUT = 5000;
const LRCLIB_BASE_URL = 'https://lrclib.net/api';

function cleanQuery(value = '') {
    return String(value)
        .replace(/\b(Official|Audio|Video|Lyrics|Theme|Soundtrack|Music|Full Version|HD|4K|Visualizer|Radio Edit|Live|Remix|Mix|Extended|Cover|Parody|Performance|Version|Unplugged|Reupload|Topic|VEVO)\b/gi, '')
        .replace(/\s*[-_/|]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hasSyncedLyrics(text) {
    return typeof text === 'string' && /\[\d{1,}:\d{2}[.:]\d{2,3}\]/.test(text);
}

function parseSyncedLyrics(text) {
    if (!hasSyncedLyrics(text)) return [];

    const parsed = [];
    for (const line of text.split(/\r?\n/)) {
        const tags = [...line.matchAll(/\[(\d{1,}):(\d{2})[.:](\d{2,3})\]/g)];
        if (!tags.length) continue;

        const lyricText = line.replace(/\[(\d{1,}):(\d{2})[.:](\d{2,3})\]/g, '').trim();
        if (!lyricText) continue;

        for (const tag of tags) {
            const minutes = Number(tag[1]);
            const seconds = Number(tag[2]);
            const milliseconds = Number(tag[3].padEnd(3, '0'));
            parsed.push({
                time: minutes * 60000 + seconds * 1000 + milliseconds,
                text: lyricText
            });
        }
    }

    return parsed.sort((a, b) => a.time - b.time);
}

function stripTimestamps(text = '') {
    return String(text)
        .replace(/\[\d{1,}:\d{2}[.:]\d{2,3}\]/g, '')
        .replace(/\r/g, '')
        .trim();
}

function getCurrentLineIndex(syncedLines, position) {
    for (let i = syncedLines.length - 1; i >= 0; i--) {
        if (position >= syncedLines[i].time) return i;
    }
    return 0;
}

function normalizeResult(record, source) {
    const syncedLyrics = typeof record.syncedLyrics === 'string' ? record.syncedLyrics : '';
    const rawPlainLyrics = typeof record.plainLyrics === 'string' && record.plainLyrics.trim()
        ? record.plainLyrics.trim()
        : stripTimestamps(syncedLyrics || record.lyrics || '');
    const plainLyrics = hasSyncedLyrics(rawPlainLyrics) ? stripTimestamps(rawPlainLyrics) : rawPlainLyrics;

    return {
        trackName: record.trackName || record.title || '',
        artistName: record.artistName || record.artist || '',
        albumName: record.albumName || '',
        duration: Number(record.duration) || null,
        instrumental: Boolean(record.instrumental),
        plainLyrics,
        syncedLyrics,
        lyrics: plainLyrics || syncedLyrics || record.lyrics || '',
        source
    };
}

function textSimilarity(left, right) {
    const a = cleanQuery(left).toLowerCase();
    const b = cleanQuery(right).toLowerCase();
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;

    const words = new Set(a.split(' ').filter(Boolean));
    const matches = b.split(' ').filter(word => words.has(word)).length;
    return matches / Math.max(words.size, 1);
}

function selectLrcLibResult(results, title, artist, durationSeconds, syncedOnly) {
    if (!Array.isArray(results)) return null;
    const candidates = results
        .filter(result => result && (result.plainLyrics || result.syncedLyrics))
        .filter(result => !syncedOnly || hasSyncedLyrics(result.syncedLyrics))
        .map((result, index) => {
            let score = textSimilarity(title, result.trackName) * 4;
            if (artist && result.artistName) score += textSimilarity(artist, result.artistName) * 3;
            if (durationSeconds && result.duration) {
                const difference = Math.abs(Number(result.duration) - durationSeconds);
                score += difference <= 5 ? 2 : difference <= 15 ? 1 : 0;
            }
            return { result, index, score };
        })
        .sort((a, b) => b.score - a.score || a.index - b.index);

    return candidates[0]?.result || null;
}

async function fetchLrcLib(title, artist, durationSeconds, syncedOnly) {
    const cleanedTitle = cleanQuery(title);
    const cleanedArtist = cleanQuery(artist);
    if (!cleanedTitle) return null;

    if (cleanedArtist && durationSeconds) {
        try {
            const response = await axios.get(`${LRCLIB_BASE_URL}/get`, {
                params: {
                    track_name: cleanedTitle,
                    artist_name: cleanedArtist,
                    duration: Math.floor(durationSeconds)
                },
                timeout: REQUEST_TIMEOUT
            });
            const result = normalizeResult(response.data || {}, 'LRCLib');
            if (result.lyrics && (!syncedOnly || hasSyncedLyrics(result.syncedLyrics))) return result;
        } catch (error) {
            if (error.response?.status !== 404) {
                console.warn('[Lyrics] LRCLib exact lookup failed:', error.message);
            }
        }
    }

    const queries = [];
    if (cleanedArtist) queries.push({ track_name: cleanedTitle, artist_name: cleanedArtist });
    queries.push({ q: `${cleanedArtist} ${cleanedTitle}`.trim() });
    if (cleanedArtist) queries.push({ q: cleanedTitle });

    for (const params of queries) {
        try {
            const response = await axios.get(`${LRCLIB_BASE_URL}/search`, {
                params,
                timeout: REQUEST_TIMEOUT
            });
            const match = selectLrcLibResult(response.data, cleanedTitle, cleanedArtist, durationSeconds, syncedOnly);
            if (match) return normalizeResult(match, 'LRCLib');
        } catch (error) {
            if (error.response?.status !== 404) {
                console.warn('[Lyrics] LRCLib search failed:', error.message);
            }
        }
    }

    return null;
}

async function fetchGenius(title, artist) {
    try {
        const Genius = require('genius-lyrics');
        const client = new Genius.Client();
        const query = `${artist || ''} ${title}`.trim();
        const results = await client.songs.search(query);
        const result = results?.[0];
        if (!result) return null;

        const lyrics = await result.lyrics();
        if (!lyrics || !lyrics.trim()) return null;

        return normalizeResult({
            trackName: result.title || title,
            artistName: result.artist?.name || artist,
            lyrics,
            plainLyrics: lyrics,
            syncedLyrics: hasSyncedLyrics(lyrics) ? lyrics : ''
        }, 'Genius');
    } catch (error) {
        console.warn('[Lyrics] Genius lookup failed:', error.message);
        return null;
    }
}

async function fetchSomeRandomApi(title, artist) {
    try {
        const query = `${artist || ''} ${title}`.trim();
        const response = await axios.get('https://some-random-api.com/lyrics', {
            params: { title: query },
            timeout: REQUEST_TIMEOUT
        });
        const lyrics = response.data?.lyrics;
        if (typeof lyrics !== 'string' || !lyrics.trim()) return null;

        return normalizeResult({
            trackName: response.data.title || title,
            artistName: response.data.author || artist,
            lyrics,
            plainLyrics: lyrics,
            syncedLyrics: hasSyncedLyrics(lyrics) ? lyrics : ''
        }, 'Some Random API');
    } catch (error) {
        console.warn('[Lyrics] Some Random API lookup failed:', error.message);
        return null;
    }
}

async function fetchSpotifySyncedLyrics(title, artist) {
    try {
        const query = `${cleanQuery(title)} ${cleanQuery(artist)}`.trim();
        const response = await axios.get('https://spotify-lyric-api.herokuapp.com/', {
            params: { trackid: query, format: 'lrc' },
            timeout: REQUEST_TIMEOUT
        });

        const data = response.data;
        if (data?.syncType === 'LINE_SYNCED' && Array.isArray(data.lines)) {
            const syncedLyrics = data.lines.map(line => {
                const timeMs = Number(line.startTimeMs);
                if (!Number.isFinite(timeMs)) return '';
                const minutes = String(Math.floor(timeMs / 60000)).padStart(2, '0');
                const seconds = String(Math.floor((timeMs % 60000) / 1000)).padStart(2, '0');
                const centiseconds = String(Math.floor((timeMs % 1000) / 10)).padStart(2, '0');
                return `[${minutes}:${seconds}.${centiseconds}] ${line.words || ''}`;
            }).filter(Boolean).join('\n');

            if (hasSyncedLyrics(syncedLyrics)) {
                return normalizeResult({ trackName: title, artistName: artist, syncedLyrics }, 'Spotify');
            }
        }

        if (typeof data?.lyrics === 'string' && hasSyncedLyrics(data.lyrics)) {
            return normalizeResult({ trackName: title, artistName: artist, syncedLyrics: data.lyrics }, 'Spotify');
        }
    } catch (error) {
        console.warn('[Lyrics] Spotify synced lookup failed:', error.message);
    }

    return null;
}

async function fetchLyrics(title, artist = '', durationSeconds = null) {
    const lrcLib = await fetchLrcLib(title, artist, durationSeconds, false);
    if (lrcLib) return lrcLib;

    const genius = await fetchGenius(title, artist);
    if (genius) return genius;

    return fetchSomeRandomApi(title, artist);
}

async function fetchSyncedLyrics(title, artist = '', durationSeconds = null) {
    const lrcLib = await fetchLrcLib(title, artist, durationSeconds, true);
    if (lrcLib) return lrcLib;

    const genius = await fetchGenius(title, artist);
    if (genius && hasSyncedLyrics(genius.syncedLyrics)) return genius;

    const randomApi = await fetchSomeRandomApi(title, artist);
    if (randomApi && hasSyncedLyrics(randomApi.syncedLyrics)) return randomApi;

    return fetchSpotifySyncedLyrics(title, artist);
}

module.exports = {
    fetchLyrics,
    fetchSyncedLyrics,
    hasSyncedLyrics,
    parseSyncedLyrics,
    stripTimestamps,
    getCurrentLineIndex
};
