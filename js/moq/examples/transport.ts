#!/usr/bin/env deno run --allow-net --unstable-net --unstable-sloppy-imports examples/transport.ts

/**
 * Usage:
 *   deno run --allow-net --unstable-net examples/transport.ts
 */

import {connect } from "../src/transport";

const SERVER_URL = new URL("https://relay.cloudflare.mediaoverquic.com");
const connection = await connect(SERVER_URL);

console.log("✅ Connected to moq-transport-07 server");
