# DisplayPlus Music Hybrid
DisplayPlus Music Hybrid is a media viewer for the Even Hub, displaying current playback on Even G2 glasses with Spotify and Navidrome support.

## Supported services
 - Spotify (premium subscription required)
 - Navidrome (popular self hosted media service)
     - Your server must be on at least **version 0.62**, along with a compatible client that implements the new PlaybackReport extension, such as the Web UI, Feishin on MacOS/Windows/Linux, Arpeggi on iOS, and Symphoniom on Android. Unsupported clients will cause weird playback state issues

## The app includes:
 - Song info (title, artist, etc.)
 - Album art
 - Playback progress
 - Realtime synced lyrics
 - Playback controls (Spotify only)
 - Navidrome on-glasses client switching

## Navidrome client switching
When Navidrome is the active source:
 - Long-press enters client-switcher mode
 - Swipe cycles active clients
 - Tap selects the highlighted client
 - Double-tap exits without changing clients


## Even hub testing QR code
<img src="src/Assets/githubpagesQR.png" alt="QR Code" width="300" />
