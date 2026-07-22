import { SpotifyApi, Track, Episode } from '@spotify/web-api-ts-sdk';

export interface SpotifyPlaylistInfo {
    id: string;
    name: string;
    trackCount: number;
    uri: string;
}

export interface SpotifyTrackInfo {
    id: string;
    name: string;
    artist: string;
    uri: string;
    durationMs: number;
}
import Song, { song_placeholder } from '../model/songModel';
import { setPlaceholderLoginHint } from '../model/songModel';
import { downloadImageAsGrayscalePng, downloadImage } from './imageModel';
import { storage } from '../utils/storage';
import spotifyAuthModel from './spotifyAuthModel';

let spotifysdk!: SpotifyApi;
let spotifyAccessToken = '';

async function refreshSpotifyAccessToken(): Promise<boolean> {
    try {
        const clientId = await storage.getItem('spotify_client_id');
        const clientSecret = await storage.getItem('spotify_client_secret');
        const refreshToken = await storage.getItem('spotify_refresh_token');

        if (!clientId || !clientSecret || !refreshToken) {
            console.error('[Spotify] Cannot refresh access token: missing credentials or refresh token');
            return false;
        }

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }),
        });

        const data = await response.json();
        if (!response.ok || !data?.access_token) {
            console.error('[Spotify] Access token refresh failed:', response.status, data);
            return false;
        }

        spotifyAccessToken = data.access_token;
        const rotatedRefreshToken = data.refresh_token ?? refreshToken;
        if (rotatedRefreshToken !== refreshToken) {
            await storage.setItem('spotify_refresh_token', rotatedRefreshToken).catch(console.error);
        }

        spotifysdk = SpotifyApi.withAccessToken(clientId, {
            access_token: data.access_token,
            token_type: data.token_type ?? 'Bearer',
            expires_in: data.expires_in ?? 3600,
            refresh_token: rotatedRefreshToken,
            expires: Date.now() + (data.expires_in ?? 3600) * 1000,
        });

        return true;
    } catch (e) {
        console.error('[Spotify] Access token refresh threw:', e);
        return false;
    }
}

async function spotifyApiFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = {
        ...(init.headers ?? {}),
        'Authorization': `Bearer ${spotifyAccessToken}`,
    };
    let response = await fetch(url, { ...init, headers });
    if (response.status !== 401) {
        return response;
    }

    console.warn('[Spotify] Received 401, attempting token refresh and retry');
    const refreshed = await refreshSpotifyAccessToken();
    if (!refreshed) {
        return response;
    }

    response = await fetch(url, {
        ...init,
        headers: {
            ...(init.headers ?? {}),
            'Authorization': `Bearer ${spotifyAccessToken}`,
        },
    });
    return response;
}

export async function initSpotify(): Promise<void> {
    const clientId = await storage.getItem('spotify_client_id');
    const clientSecret = await storage.getItem('spotify_client_secret');
    const codeData = await spotifyAuthModel.checkForAuthCode();
    const requiredScopes = spotifyAuthModel.SCOPES;

    let refreshToken: string | null = null;
    try {
        const stored = await storage.getItem('spotify_refresh_token');
        if (stored && stored.length > 20) refreshToken = stored;
    } catch (e) {
        console.error('Error reading refresh token:', e);
    }

    if (!clientId || !clientSecret) {
        console.error('Spotify credentials not set');
        setPlaceholderLoginHint(true);
        return;
    }

    const storedScopes = await storage.getItem('spotify_auth_scopes');
    if (storedScopes !== requiredScopes && refreshToken) {
        console.log('[Spotify] Auth scope set changed, forcing re-auth for playlist access');
        refreshToken = null;
        await storage.removeItem('spotify_refresh_token').catch(console.error);
    }

    document.getElementById('spotify-auth-popup')!.style.display = 'none';

    const exchangeRefreshToken = async (token: string) => {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
            },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }),
        });
        const data = await response.json();
        if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
        return data;
    };

    try {
        let authData: any;

        if (codeData) {
            authData = codeData;
            if (authData.refresh_token) {
                refreshToken = authData.refresh_token;
                await storage.setItem('spotify_refresh_token', refreshToken!).catch(console.error);
                console.log('Initial refresh token saved.');
            }
        } else if (refreshToken) {
            authData = await exchangeRefreshToken(refreshToken);
        } else {
            console.error('No auth data available');
            setPlaceholderLoginHint(true);
            document.getElementById('spotify-auth-popup')!.style.display = 'flex';
            return;
        }

        setPlaceholderLoginHint(false);
        await storage.setItem('spotify_auth_scopes', requiredScopes).catch(console.error);

        // Persist rotated refresh token if Spotify issued a new one
        if (authData.refresh_token && authData.refresh_token !== refreshToken) {
            refreshToken = authData.refresh_token;
            await storage.setItem('spotify_refresh_token', refreshToken!).catch(console.error);
        }

        spotifysdk = SpotifyApi.withAccessToken(clientId, {
            access_token: authData.access_token,
            token_type: authData.token_type ?? 'Bearer',
            expires_in: authData.expires_in,
            refresh_token: refreshToken ?? '',
            expires: Date.now() + authData.expires_in * 1000,
        });
        spotifyAccessToken = authData.access_token;

        console.log('Spotify SDK initialized.');
    } catch (e) {
        console.error('Spotify auth error:', e);
        setPlaceholderLoginHint(true);
        document.getElementById('spotify-auth-popup')!.style.display = 'flex';
    }
}

class SpotifyModel {
    private lastSong = new Song();
    currentSong = new Song();
    deviceId = '';

    async fetchCurrentTrack(): Promise<Song> {
        let result;
        try {
            result = await spotifysdk.player.getPlaybackState();
        } catch {
            return song_placeholder;
        }

        if (!result?.device?.id) {
            // Nothing playing — return last known song paused, or placeholder
            if (this.lastSong.songID !== '0') {
                this.lastSong.addisPlaying(false);
                return this.lastSong;
            }
            return song_placeholder;
        }

        if (this.deviceId !== result.device.id) {
            console.log(`Device ID: ${this.deviceId} → ${result.device.id}`);
            this.deviceId = result.device.id;
        }

        if (!result.item) return song_placeholder;

        if (result.item.type === 'track') {
            const track = result.item as Track;

            if (track.id !== this.lastSong.songID) {
                // New song — build it and return immediately; fetch art in background
                const song = new Song();
                song.addID(track.id);
                song.addTitle(track.name);
                song.addArtist(track.artists[0].name);
                song.addFeatures(track.artists.slice(1).map(a => a.name));
                song.addAlbum(track.album.name);
                song.addDurationSeconds(track.duration_ms / 1000);
                song.addProgressSeconds(result.progress_ms / 1000);
                song.addisPlaying(result.is_playing);
                song.addChangedState(true);

                console.log(`Now playing: ${song.title} by ${song.artist}`);

                this.lastSong = song;
                this.currentSong = song;

                // Art fetch doesn't block — patches song object when ready
                this.fetchArtAsync(track, song);

                return song;
            }

            // Same song — update dynamic fields only
            if (this.lastSong.isPlaying !== result.is_playing) {
                console.log(result.is_playing
                    ? `Resumed: ${this.lastSong.title}`
                    : `Paused: ${this.lastSong.title}`
                );
            }
            this.lastSong.addisPlaying(result.is_playing);

            const serverProgress = result.progress_ms / 1000;
            const drift = Math.abs(serverProgress - this.lastSong.progressSeconds);
            if (drift > 0.5) {
                console.log(`[Spotify] Drift corrected: ${drift.toFixed(2)}s`);
                this.lastSong.addProgressSeconds(serverProgress);
            }

            this.lastSong.addChangedState(false);
            this.currentSong = this.lastSong;
            return this.lastSong;

        } else if (result.item.type === 'episode') {
            const episode = result.item as Episode;
            const song = new Song();
            song.type = 'Episode';
            song.addTitle(episode.name);
            song.addID(episode.id);
            console.log(`Now playing episode: ${episode.name}`);
            this.currentSong = song;
            return song;
        }

        return song_placeholder;
    }

    async fetchNextTrack(): Promise<Song | undefined> {
        try {
            const queue = await spotifysdk.player.getUsersQueue();
            const next = queue?.queue?.[0];
            if (next?.type === 'track') {
                const track = next as Track;
                const song = new Song();
                song.addID(track.id);
                song.addTitle(track.name);
                song.addArtist(track.artists[0].name);
                song.addFeatures(track.artists.slice(1).map(a => a.name));
                song.addAlbum(track.album.name);
                return song;
            }
        } catch {
            // Queue unavailable — not critical
        }
        return undefined;
    }

    private async fetchArtAsync(track: Track, song: Song): Promise<void> {
        try {
            const url = track.album.images[0].url;
            const [raw, color] = await Promise.all([
                downloadImageAsGrayscalePng(url, 144, 144),
                downloadImage(url, 120, 120),
            ]);
            // Only patch if this song is still current
            if (this.currentSong === song) {
                song.addArtRaw(raw);
                song.addArtColor(color);
                console.log(`[Spotify] Art ready for: ${song.title}`);
            }
        } catch (e) {
            console.error('[Spotify] Art fetch failed:', e);
        }
    }

    async song_Pause() {
        try {
            this.currentSong?.addisPlaying(false);
            await spotifysdk.player.pausePlayback(this.deviceId);
        } catch (e) { console.error('Pause failed:', e); }
    }

    async song_Play() {
        try {
            this.currentSong?.addisPlaying(true);
            try {
                await spotifysdk.player.startResumePlayback(this.deviceId);
            } catch {
                // Cached deviceId may be stale after dormancy — retry on active device
                console.warn('[Spotify] Play with cached deviceId failed, retrying on active device');
                await spotifysdk.player.startResumePlayback('');
            }
        } catch (e) { console.error('Play failed:', e); }
    }

    async song_Back() {
        try {
            await spotifysdk.player.skipToPrevious(this.deviceId);
        } catch (e) { console.error('Back failed:', e); }
    }

    async song_Forward() {
        try {
            await spotifysdk.player.skipToNext(this.deviceId);
        } catch (e) { console.error('Forward failed:', e); }
    }

    async getPlaylists(): Promise<SpotifyPlaylistInfo[]> {
        try {
            const response = await spotifyApiFetch('https://api.spotify.com/v1/me/playlists?limit=50');
            if (!response.ok) {
                console.error('[Spotify] getPlaylists HTTP error:', response.status, await response.text());
                return [];
            }
            const result = await response.json();
            return (result.items ?? []).map((p: any) => ({
                id: p.id,
                name: p.name,
                trackCount: p.tracks?.total ?? 0,
                uri: p.uri,
            }));
        } catch (e) {
            console.error('[Spotify] getPlaylists failed:', e);
            return [];
        }
    }

    async getPlaylistTracks(playlistId: string): Promise<SpotifyTrackInfo[]> {
        try {
            const tracks: SpotifyTrackInfo[] = [];
            let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

            while (nextUrl && tracks.length < 500) {
                const response = await spotifyApiFetch(nextUrl);
                if (!response.ok) {
                    console.error('[Spotify] getPlaylistTracks HTTP error:', response.status, await response.text());
                    return tracks;
                }

                const result = await response.json();
                const pageTracks = (result.items ?? [])
                    .filter((item: any) => item?.track?.type === 'track')
                    .map((item: any) => ({
                        id: item.track.id,
                        name: item.track.name,
                        artist: item.track.artists?.[0]?.name ?? 'Unknown',
                        uri: item.track.uri,
                        durationMs: item.track.duration_ms,
                    }));
                tracks.push(...pageTracks);

                nextUrl = typeof result?.next === 'string' ? result.next : null;
            }

            return tracks;
        } catch (e) {
            console.error('[Spotify] getPlaylistTracks failed:', e);
            return [];
        }
    }

    async playTrack(trackUri: string): Promise<void> {
        try {
            try {
                await spotifysdk.player.startResumePlayback(this.deviceId, undefined, [trackUri]);
            } catch {
                await spotifysdk.player.startResumePlayback('', undefined, [trackUri]);
            }
        } catch (e) { console.error('playTrack failed:', e); }
    }

    async playPlaylist(playlistId: string): Promise<void> {
        const contextUri = `spotify:playlist:${playlistId}`;
        try {
            const authHeaders = { 'Content-Type': 'application/json' };
            const shuffleUris = (uris: string[]): string[] => {
                const copy = [...uris];
                for (let i = copy.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const tmp = copy[i];
                    copy[i] = copy[j];
                    copy[j] = tmp;
                }
                return copy;
            };

            const chooseDeviceId = async (): Promise<string | null> => {
                const response = await spotifyApiFetch('https://api.spotify.com/v1/me/player/devices', { method: 'GET' });
                if (!response.ok) {
                    console.error('[Spotify] get devices HTTP error:', response.status, await response.text());
                    return this.deviceId || null;
                }

                const result = await response.json();
                const devices = Array.isArray(result?.devices) ? result.devices : [];
                const controllableDevices = devices.filter((d: any) => d && d.id && d.is_restricted !== true);
                if (controllableDevices.length === 0) {
                    return this.deviceId || null;
                }

                const cached = controllableDevices.find((d: any) => d.id === this.deviceId);
                if (cached) {
                    return cached.id;
                }

                const active = controllableDevices.find((d: any) => d.is_active === true);
                return (active?.id ?? controllableDevices[0].id ?? null) as string | null;
            };

            const transferPlayback = async (deviceId: string): Promise<void> => {
                const response = await spotifyApiFetch('https://api.spotify.com/v1/me/player', {
                    method: 'PUT',
                    headers: authHeaders,
                    body: JSON.stringify({
                        device_ids: [deviceId],
                        play: true,
                    }),
                });
                if (!response.ok) {
                    console.error('[Spotify] transfer playback HTTP error:', response.status, await response.text());
                }
            };

            const tryPlayContext = async (deviceId: string | null): Promise<boolean> => {
                const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
                const response = await spotifyApiFetch(`https://api.spotify.com/v1/me/player/play${query}`, {
                    method: 'PUT',
                    headers: authHeaders,
                    body: JSON.stringify({
                        context_uri: contextUri,
                        offset: { position: 0 },
                        position_ms: 0,
                    }),
                });
                if (response.ok) return true;
                console.error('[Spotify] playPlaylist HTTP error:', response.status, await response.text());
                return false;
            };

            const tryPlayUris = async (uris: string[], deviceId: string | null): Promise<boolean> => {
                if (uris.length === 0) return false;

                try {
                    await spotifysdk.player.startResumePlayback(deviceId ?? '', undefined, uris);
                    return true;
                } catch (sdkError) {
                    console.warn('[Spotify] SDK URI playback failed, retrying via REST:', sdkError);
                }

                const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
                const response = await spotifyApiFetch(`https://api.spotify.com/v1/me/player/play${query}`, {
                    method: 'PUT',
                    headers: authHeaders,
                    body: JSON.stringify({
                        uris,
                        position_ms: 0,
                    }),
                });
                if (response.ok) return true;
                console.error('[Spotify] URI playlist playback HTTP error:', response.status, await response.text());
                return false;
            };

            const ensureShuffleEnabled = async (deviceId: string | null): Promise<void> => {
                const playbackResponse = await spotifyApiFetch('https://api.spotify.com/v1/me/player', { method: 'GET' });
                if (!playbackResponse.ok) {
                    console.error('[Spotify] shuffle check HTTP error:', playbackResponse.status, await playbackResponse.text());
                    return;
                }

                const playbackState = await playbackResponse.json();
                if (playbackState?.shuffle_state === true) {
                    return;
                }

                const shuffleQuery = `?state=true${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`;
                const shuffleResponse = await spotifyApiFetch(`https://api.spotify.com/v1/me/player/shuffle${shuffleQuery}`, { method: 'PUT' });
                if (!shuffleResponse.ok) {
                    console.error('[Spotify] enable shuffle HTTP error:', shuffleResponse.status, await shuffleResponse.text());
                }
            };

            const targetDeviceId = await chooseDeviceId();
            if (targetDeviceId) {
                await transferPlayback(targetDeviceId);
                this.deviceId = targetDeviceId;
            }

            // Primary path: play concrete playlist track URIs (shuffled client-side).
            const tracks = await this.getPlaylistTracks(playlistId);
            const shuffledUris = shuffleUris(
                tracks
                    .map(track => track.uri)
                    .filter((uri): uri is string => typeof uri === 'string' && uri.length > 0),
            );
            const urisToPlay = shuffledUris.slice(0, 100);
            if (await tryPlayUris(urisToPlay, targetDeviceId)) {
                return;
            }
            if (await tryPlayUris(urisToPlay, null)) {
                return;
            }

            // Secondary path: context playback for full server-side playlist behavior.
            if (await tryPlayContext(targetDeviceId)) {
                await ensureShuffleEnabled(targetDeviceId);
                return;
            }
            if (await tryPlayContext(null)) {
                await ensureShuffleEnabled(null);
                return;
            }

            // Final fallback: play first track directly.
            const firstTrack = tracks[0];
            if (firstTrack) {
                await this.playTrack(firstTrack.uri);
            }
        } catch (e) { console.error('playPlaylist failed:', e); }
    }
}

const spotifyModel = new SpotifyModel();
export default spotifyModel;