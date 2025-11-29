import { Icons } from "./element";

export const SVGS: Record<Icons, string> = {
    network: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hang-icon hang-icon-network">
            <path d="M16.247 7.761a6 6 0 0 1 0 8.478"/>
            <path d="M19.075 4.933a10 10 0 0 1 0 14.134"/>
            <path d="M4.925 19.067a10 10 0 0 1 0-14.134"/>
            <path d="M7.753 16.239a6 6 0 0 1 0-8.478"/>
            <circle cx="12" cy="12" r="2"/>
        </svg>
    `,
    video: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hang-icon hang-icon-video">
            <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/>
            <rect x="2" y="6" width="14" height="12" rx="2"/>
        </svg>
    `,
    audio: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hang-icon hang-icon-audio">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
        </svg>
    `,
    buffer: `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hang-icon hang-icon-buffer">
            <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>
        </svg>
    `
};

type Colors = "primary" | "bgPrimary" | "bgSecondary";

type CommonColors = {
    common: {
        lightGrey: string;
        darkGrey: string;
        black: string;
    };
};

type ThemeColors = Record<Icons, Record<Colors, string>>;

export const COLORS: ThemeColors & CommonColors = {
    common: {
        lightGrey: "#9ca3af",
        darkGrey: "rgba(255, 255, 255, 0.25)",
        black: "#000000",
    },
    network: {
        primary: "#38bdf8",
        bgPrimary: "#1b3243",
        bgSecondary: "#060608",
    },
    video: {
        primary: "#b88aff",
        bgPrimary: "#31144a",
        bgSecondary: "#060608",
    },
    audio: {
        primary: "#7cb94e",
        bgPrimary: "#3d4928",
        bgSecondary: "#060608",
    },
    buffer: {
        primary: "#ff9933",
        bgPrimary: "#4d301b",
        bgSecondary: "#060608",
    },
};

type Spacing = "s" | "m" | "l";

export const SPACING: Record<Spacing, string> = {
    s: "8px",
    m: "12px",
    l: "16px",
};