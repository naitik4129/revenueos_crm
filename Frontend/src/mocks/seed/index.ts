// Mock dataset backing the prototype. One file per domain, all authored
// against the fixed clock in ./clock so relative dates stay meaningful.
//
// This is the single place the app gets its initial state from. Replacing it
// with a backend means changing the store slices in src/store/slices to fetch
// instead of seeding — no component reads from here directly.
export { TODAY, at, d } from "./clock";
export { leads } from "./leads";
export { meetings } from "./meetings";
export { notifications } from "./notifications";
export { proposals } from "./proposals";
export { runs } from "./runs";
export { tasks } from "./tasks";
export { templates } from "./templates";
export { timeline } from "./timeline";
export { currentUser, currentUserId, users } from "./users";
export { workflows } from "./workflows";
