import { storage } from '../utils/storage';

export const SPOTIFY_AUTH_SCOPES =
    'user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative';
export const SPOTIFY_REDIRECT_URI_STORAGE_KEY = 'spotify_redirect_uri';
export const SPOTIFY_AUTH_REDIRECT_URI_STORAGE_KEY = 'spotify_auth_redirect_uri';

export function getRuntimeRedirectUri(): string {
    return `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`;
}

class SpotifyAuthModel {
    async getRedirectUri(): Promise<string> {
        const stored = await storage.getItem(SPOTIFY_REDIRECT_URI_STORAGE_KEY);
        const redirectUri = stored?.trim();
        return redirectUri || getRuntimeRedirectUri();
    }
    SCOPES = SPOTIFY_AUTH_SCOPES;

    /**
     * Generates a random string for state parameter
     */
    generateRandomString(length: number): string {
        const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        array = array.map(x => validChars.charCodeAt(x % validChars.length));
        return String.fromCharCode.apply(null, Array.from(array));
    }

    /**
     * Initiates the Auth Flow by redirecting the user to Spotify
     */
    async generateAuthUrl(clientId: string): Promise<void> {
        const redirectUri = await this.getRedirectUri();
        console.log("Using Redirect URI: " + redirectUri);
        const state = this.generateRandomString(16);
        await storage.setItem('spotify_auth_state', state);
        await storage.setItem(SPOTIFY_AUTH_REDIRECT_URI_STORAGE_KEY, redirectUri);

        const authUrl = new URL("https://accounts.spotify.com/authorize");
        const params = {
            response_type: 'code',
            client_id: clientId,
            scope: this.SCOPES,
            redirect_uri: redirectUri,
            state: state,
        };

        authUrl.search = new URLSearchParams(params).toString();
        // Redirect the whole page
        window.location.href = authUrl.toString();
    }

    /**
     * Exchanges an auth code for a refresh token
     */
    async exchangeCodeForToken(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<any | null> {
        try {
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret)
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri,
                }),
            });

            const data = await response.json();

            if (data.refresh_token && data.access_token) {
                return data;
            } else {
                console.error('Error exchanging token:', data);
                return null;
            }
        } catch (err) {
            console.error('Network error exchanging token:', err);
            return null;
        }
    }

    /**
     * Checks the URL for an auth code and exchanges it for tokens
     * Returns the token data if successful, or null if no code found/error
     */
    async checkForAuthCode(): Promise<any | null> {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');

        if (!code) return null;

        // Clean the URL
        window.history.replaceState({}, document.title, window.location.pathname);

        const savedState = await storage.getItem('spotify_auth_state');
        if (state !== savedState) {
            console.error("State mismatch");
            return null;
        }
        await storage.removeItem('spotify_auth_state');

        const clientId = await storage.getItem('spotify_client_id');
        const clientSecret = await storage.getItem('spotify_client_secret');
        const redirectUri = (await storage.getItem(SPOTIFY_AUTH_REDIRECT_URI_STORAGE_KEY)) || await this.getRedirectUri();

        if (!clientId || !clientSecret) return null;

        await storage.removeItem(SPOTIFY_AUTH_REDIRECT_URI_STORAGE_KEY);
        return await this.exchangeCodeForToken(code, clientId, clientSecret, redirectUri);
    }
}

const spotifyAuthModel = new SpotifyAuthModel();
export default spotifyAuthModel;
