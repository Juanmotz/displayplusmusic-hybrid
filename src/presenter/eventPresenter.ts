import { waitForEvenAppBridge, OsEventTypeList } from "@evenrealities/even_hub_sdk";
import spotifyPresenter from './spotifyPresenter';

function getEventTypeName(eventType: number | undefined): string {
    if (eventType === undefined) {
        return '';
    }

    try {
        return String(OsEventTypeList.fromJson(eventType));
    } catch {
        return '';
    }
}

function isSwipeForwardEvent(name: string): boolean {
    return name.includes('SCROLL_TOP_EVENT');
}

function isSwipeBackEvent(name: string): boolean {
    return name.includes('SCROLL_BOTTOM_EVENT');
}

function isTapEvent(name: string): boolean {
    return name.includes('CLICK_EVENT') && !name.includes('DOUBLE');
}

function isDoubleTapEvent(name: string): boolean {
    return name.includes('DOUBLE_CLICK_EVENT');
}

function isLongPressEvent(name: string): boolean {
    return name.includes('LONG_PRESS_EVENT')
        || name.includes('LONG_CLICK_EVENT')
        || (name.includes('LONG') && name.includes('PRESS'));
}

export async function eventHandler() {
    const bridge = await waitForEvenAppBridge();

    const unsubscribe = bridge.onEvenHubEvent(async (event) => {
        const listEvent = event.listEvent;
        const sysEvent = event.sysEvent;

        const source = spotifyPresenter.getActiveSource();
        const eventType = listEvent?.eventType ?? (event as any).textEvent?.eventType ?? sysEvent?.eventType;
        const eventTypeName = getEventTypeName(eventType);

        if (source === 'navidrome') {
            if (isLongPressEvent(eventTypeName)) {
                spotifyPresenter.enterNavidromeClientSwitcherMode();
                return;
            }

            if (spotifyPresenter.isInNavidromeClientSwitcherMode()) {
                if (isSwipeForwardEvent(eventTypeName)) {
                    spotifyPresenter.cycleNavidromeClientSwitcher(-1);
                    return;
                }

                if (isSwipeBackEvent(eventTypeName)) {
                    spotifyPresenter.cycleNavidromeClientSwitcher(1);
                    return;
                }

                if (isTapEvent(eventTypeName)) {
                    await spotifyPresenter.selectNavidromeClientSwitcherClient();
                    return;
                }

                if (isDoubleTapEvent(eventTypeName)) {
                    spotifyPresenter.cancelNavidromeClientSwitcherMode();
                    return;
                }
            }
        }

        if (listEvent) {
            console.log(listEvent.currentSelectItemIndex + " " + listEvent.currentSelectItemName);
            if (source === 'navidrome') {
                return;
            }

            // Long-press enters playlist browser
            if (isLongPressEvent(eventTypeName) && !spotifyPresenter.isInBrowseMode()) {
                await spotifyPresenter.enterBrowseMode();
                return;
            }

            // Playlist browser navigation
            if (spotifyPresenter.isInBrowseMode()) {
                switch (listEvent.currentSelectItemIndex) {
                    case 0: spotifyPresenter.browseScrollUp(); break;
                    case 2: spotifyPresenter.browseScrollDown(); break;
                    default: {
                        const status = spotifyPresenter.getBrowseStatus();
                        if (status.mode === 'playlists') {
                            await spotifyPresenter.openSelectedPlaylist();
                        } else if (status.mode === 'tracks') {
                            await spotifyPresenter.playSelectedTrack();
                        }
                        break;
                    }
                }
                return;
            }

            switch (listEvent.currentSelectItemIndex) {
                case 1:
                    spotifyPresenter.song_pauseplay();
                    break;
                case 2:
                    spotifyPresenter.song_forward();
                    break;
                default:
                    spotifyPresenter.song_back();
                    break;
            }
        }
        if (event.sysEvent) {
            const eventType = event.sysEvent.eventType;
            if (eventType == OsEventTypeList.DOUBLE_CLICK_EVENT) {
                // Back out of browser before shutdown
                if (spotifyPresenter.isInBrowseMode()) {
                    spotifyPresenter.browseBack();
                    return;
                }
                console.log('double tap event, shutting down app');
                if (await bridge.shutDownPageContainer(1)) {
                    console.log("successfull shutdown");
                } else {
                    console.log("failed shutdown");
                }
            }
        }
    });

    // Return unsubscribe in case we need to stop listening later
    return unsubscribe;
}