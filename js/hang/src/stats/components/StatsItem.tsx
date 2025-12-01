/**
 * Stats Item component for displaying individual metrics
 * @module components/StatsItem
 */

import { createSignal } from "solid-js";
import type { Icons } from "../constants";

interface StatsItemProps {
    icon: Icons;
    svg: string;
}

export const StatsItem = (props: StatsItemProps) => {
    // TODO: Connect to actual metrics from broadcast
    const [displayData] = createSignal("N/A");

    return (
        <div class={`stats__item stats__item--${props.icon}`}>
            <div class="stats__icon-wrapper">
                <div class="stats__icon" innerHTML={props.svg} />
            </div>

            <div class="stats__item-detail">
                <span class="stats__item-text">{props.icon}</span>
                <span class="stats__item-data">{displayData()}</span>
            </div>
        </div>
    );
};
