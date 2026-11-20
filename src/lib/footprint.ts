/**
 * What home leaves on a coordinator's pod, and elsewhere (mom-home #48).
 *
 * One list, read three ways: home's section of `settings/README.md` is written
 * from it (settings/home.ts), `docs/reference/pod-footprint.md` names every
 * entry, and footprint.test.ts fails when a write appears in the code that this
 * list hasn't been told about. An owner leaving home (or a tool doing it for
 * them, solid-backoffice#16) removes what is `own` and home's entries inside
 * `entry` files; `plumbing` is the pod's, whoever made it, and stays.
 *
 * How an app declares this on the pod itself, for other apps to read, is
 * solid-kit#22's to decide; until then the README section is the declaration.
 */
import { SESSION_ID } from "../config";

export type FootprintKind =
  /** Home's own file: removing it removes nothing of anyone else's. */
  | "own"
  /** Home's part of a file other apps share: only that part is home's. */
  | "entry"
  /** Standard Solid files and links home made only because the pod lacked them: the pod's, never home's to remove. */
  | "plumbing"
  /** Not on the pod: the account and pod themselves, the map's copy. */
  | "outside";

export interface FootprintMark {
  id: string;
  kind: FootprintKind;
  /** Where, from the pod root (or what, for `outside`). */
  where: string;
  /** What it holds, in the owner's words. */
  what: string;
  /** The functions that write it (file:function), for the reader of the code. */
  writtenBy: string[];
}

export const FOOTPRINT: readonly FootprintMark[] = [
  {
    id: "space-file",
    kind: "own",
    where: "space.ttl",
    what: "your space's file: what the map shows about it (home changes the lines you edit in the tool, hours and logo lines, and its address with the pin when it moves)",
    writtenBy: ["lib/publish.ts:writeSpaceFile", "lib/hours.ts:changeStatement", "lib/move.ts:moveSpace", "lib/profile.ts:saveProfile"],
  },
  {
    id: "space-acl",
    kind: "own",
    where: "the access rules of space.ttl (space.ttl.acl on this server)",
    what: "lets anyone read that one file, so the map can",
    writtenBy: ["lib/publish.ts:makeSpacePublic"],
  },
  {
    id: "logo-file",
    kind: "own",
    where: "logo, and its access rules",
    what: "your space's logo, readable by anyone so the card can show it",
    writtenBy: ["lib/logo.ts:uploadLogo"],
  },
  {
    id: "collective-inbox",
    kind: "own",
    where: "inbox/, and its access rules",
    what: "for a network: where requests to join arrive; anyone signed in may leave one, only you read them (made only if missing)",
    writtenBy: ["lib/collective.ts:createInbox"],
  },
  {
    id: "collective-roster",
    kind: "own",
    where: "membres.ttl (or the roster config.ttl names), and its access rules",
    what: "for a network: who its members are, empty at first; only you read it, and the backoffice lets each member you accept read it too",
    writtenBy: ["lib/collective.ts:writeRoster"],
  },
  {
    id: "collective-config",
    kind: "own",
    where: "config.ttl, and its access rules",
    what: "for a network: the network as a collective, its name, the invitation's words, where its roster and inbox are; anyone can read it (written only if missing)",
    writtenBy: ["lib/collective.ts:writeConfig"],
  },
  {
    id: "space-collective-link",
    kind: "own",
    where: "space.ttl, one line (rdfs:seeAlso)",
    what: "for a network: the link from your network's file to its config.ttl, added once",
    writtenBy: ["lib/collective.ts:linkSpace"],
  },
  {
    id: "settings-file",
    kind: "own",
    where: `settings/${SESSION_ID}.ttl`,
    what: 'whether you keep "What you can do" folded, and which tile tutorials you have seen',
    writtenBy: ["settings/home.ts:changeHomeSettings"],
  },
  {
    id: "readme-section",
    kind: "entry",
    where: "settings/README.md",
    what: "this section (and the whole file, if home was first to write one)",
    writtenBy: ["settings/home.ts:ensureSettingsReadme"],
  },
  {
    id: "public-index-entry",
    kind: "entry",
    where: "settings/publicTypeIndex.ttl, entry #mom-space",
    what: "where your space's file is, so apps can find it",
    writtenBy: ["lib/typeindex.ts:registerSpace"],
  },
  {
    id: "private-index-entry",
    kind: "entry",
    where: "settings/privateTypeIndex.ttl, entry #mom-home-settings",
    what: "where home's settings file is",
    writtenBy: ["settings/home.ts:registerInTypeIndex"],
  },
  {
    id: "indexes",
    kind: "plumbing",
    where: "settings/publicTypeIndex.ttl, settings/privateTypeIndex.ttl, settings/prefs.ttl",
    what: "the pod's Type Indexes and preferences file, made only if the pod had none",
    writtenBy: ["lib/typeindex.ts:ensureIndexes"],
  },
  {
    id: "profile-links",
    kind: "plumbing",
    where: "your profile (profile/card)",
    what: "the links to those files (solid:publicTypeIndex, pim:preferencesFile), added only if missing, never changed",
    writtenBy: ["lib/typeindex.ts:ensureIndexes"],
  },
  {
    id: "account",
    kind: "outside",
    where: "the pod server",
    what: "your account and pod, when you made them in home",
    writtenBy: ["lib/register.ts:createAccount"],
  },
  {
    id: "map-registration",
    kind: "outside",
    where: "the map (mapsofmaking.org)",
    what: "the address of your space's file, and the map's copy of what it read there",
    writtenBy: ["lib/onmap.ts:putOnMap", "lib/onmap.ts:rereadOnMap"],
  },
];
