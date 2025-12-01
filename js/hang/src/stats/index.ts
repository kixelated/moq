import HangStats from "./element";

export default HangStats;
export type { Icons } from "./constants";

customElements.define("hang-stats", HangStats);

declare global {
    interface HTMLElementTagNameMap {
        "hang-stats": HangStats;
    }
}