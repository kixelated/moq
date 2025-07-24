export * from "./announced";
export * from "./broadcast";
export * from "./connection";
export * from "./group";
export * as Lite from "./lite";
export * as Path from "./path";
export * from "./track";
export * as Transport from "./transport";

// Default to establishing a moq-lite connection.
// TODO: Switch automatically based on the server's version.
import * as Lite from "./lite";
export const connect = Lite.Connection.connect;
