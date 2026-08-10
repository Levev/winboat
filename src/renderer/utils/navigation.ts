export type RemoveNavigationEvents = () => void;

export function addNavigationEvents(goBack: () => void): RemoveNavigationEvents {
    const mouseBack = (event: MouseEvent) => {
        if (event.button === 3) goBack();
    };

    const escBack = (event: KeyboardEvent) => {
        if (event.key === "Escape") goBack();
    };

    window.addEventListener("mouseup", mouseBack);
    window.addEventListener("keyup", escBack);

    return () => {
        window.removeEventListener("mouseup", mouseBack);
        window.removeEventListener("keyup", escBack);
    };
}
