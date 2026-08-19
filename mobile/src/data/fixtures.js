/**
 * Prototype fixtures — used ONLY in demo mode (API unreachable).
 *
 * Shapes match the real API responses exactly, so a screen written against a
 * fixture needs no changes when the backend comes up.
 *
 * NOTE ON DISTANCE: the Lovable prototype prints exact distances ("0.3 km").
 * The real API cannot and must not do that — `grid.nearby` returns a
 * pre-bucketed label, because an exact distance alongside a fuzzed coordinate
 * hands the true position straight back (CLAUDE.md §2.2, backend
 * distance-buckets.ts). These fixtures therefore use the SERVER's bucket
 * labels, not the prototype's decimals, so the demo does not teach a layout
 * that production can never fill.
 */

const BUCKETS = ['<1 km', '1-3 km', '3-10 km', '10-50 km'];
const INTENTS = ['Dating', 'Friends', 'Activities', 'Networking', 'Chat'];

const NAMES = [
  ['Kiara', 33], ['Krish', 27], ['Aanya', 26], ['Rohan', 29], ['Rehan', 31],
  ['Saanvi', 24], ['Ishita', 27], ['Dev', 28], ['Meera', 30], ['Arjun', 26],
  ['Nisha', 25], ['Kabir', 32], ['Tara', 28], ['Vikram', 34], ['Priya', 23],
  ['Aditya', 29], ['Zoya', 27], ['Nikhil', 31], ['Riya', 25], ['Sameer', 30],
  ['Ananya', 26], ['Yash', 28], ['Diya', 24], ['Omkar', 33],
];

/** Deterministic pseudo-random so the demo grid is stable across reloads. */
function seeded(i, mod) {
  return ((i * 2654435761) >>> 0) % mod;
}

export const gridPeople = NAMES.map(([displayName, age], i) => {
  const locked = seeded(i + 7, 10) < 4; // ~40% locked, matching the prototype
  return {
    publicShortId: `demo-${i.toString(36)}${displayName.toLowerCase()}`,
    displayName,
    age,
    gender: seeded(i + 3, 2) ? 'FEMALE' : 'MALE',
    isVerified: seeded(i + 11, 10) < 5,
    interests: [],
    lookingFor: [INTENTS[seeded(i + 5, INTENTS.length)]],
    distance: BUCKETS[Math.min(3, Math.floor(i / 7))],
    online: seeded(i + 2, 10) < 6,
    photo: null, // demo has no storage; the gradient wash stands in
    photosBlurred: locked,
  };
});

export const gridMeta = { onlineCount: 55 };

export const pingChats = [
  {
    id: 'demo-chat-1',
    peer: { displayName: 'Rohan', age: 29, publicShortId: 'demo-3rohan', photosBlurred: false, isVerified: true },
    lastMessage: "Saw you're in the 5AM Run Club too — Cubbon tomorrow?",
    distance: '<1 km',
    tags: ['Activities', 'Friends'],
    updatedAt: '12m',
    unread: 2,
  },
  {
    id: 'demo-chat-2',
    peer: { displayName: 'Ishita', age: 27, publicShortId: 'demo-6ishita', photosBlurred: true, isVerified: true },
    lastMessage: 'Your bio said films > most things. Worst film you loved?',
    distance: '1-3 km',
    tags: ['Friends', 'Dating'],
    updatedAt: '1h',
    unread: 0,
  },
  {
    id: 'demo-chat-3',
    peer: { displayName: 'Dev', age: 28, publicShortId: 'demo-7dev', photosBlurred: false, isVerified: false },
    lastMessage: 'Half marathon in October — want a training partner?',
    distance: '3-10 km',
    tags: ['Activities'],
    updatedAt: '3h',
    unread: 0,
  },
];

export const pingRequests = [
  {
    id: 'demo-req-1',
    peer: { displayName: 'Meera', age: 30, publicShortId: 'demo-8meera', photosBlurred: true, isVerified: true },
    message: 'Your bookshelf photo — is that the Ferrante set? Coffee sometime?',
    distance: '<1 km',
    tags: ['Friends'],
    updatedAt: '25m',
    status: 'PENDING',
  },
  {
    id: 'demo-req-2',
    peer: { displayName: 'Arjun', age: 26, publicShortId: 'demo-9arjun', photosBlurred: false, isVerified: false },
    message: 'Fellow climber at Boulder Box? Looking for a belay partner.',
    distance: '1-3 km',
    tags: ['Activities'],
    updatedAt: '2h',
    status: 'PENDING',
  },
  {
    id: 'demo-req-3',
    peer: { displayName: 'Zoya', age: 27, publicShortId: 'demo-16zoya', photosBlurred: true, isVerified: true },
    message: 'Saw you run the design meetup — would love to pick your brain.',
    distance: '3-10 km',
    tags: ['Networking'],
    updatedAt: '5h',
    status: 'PENDING',
  },
];

export const circleList = [
  {
    id: 'demo-circle-1',
    name: 'Sunday Treks',
    description: 'Weekly day-treks within 80km of Bangalore',
    category: 'Activities',
    members: 412,
    tier: 'OPEN',
    joined: true,
  },
  {
    id: 'demo-circle-2',
    name: 'Founders Over Coffee',
    description: 'Early founders, no pitch decks',
    category: 'Networking',
    members: 138,
    tier: 'INVITE_ONLY',
    joined: true,
  },
  {
    id: 'demo-circle-3',
    name: '5AM Run Club',
    description: 'Cubbon park, MG road, Lalbagh loops',
    category: 'Activities',
    members: 287,
    tier: 'OPEN',
    joined: true,
  },
  {
    id: 'demo-circle-4',
    name: 'Film Club Blr',
    description: 'Second Saturday screenings, arthouse leaning',
    category: 'Community',
    members: 96,
    tier: 'OPEN',
    joined: false,
  },
  {
    id: 'demo-circle-5',
    name: 'Indiranagar Supper Club',
    description: 'Rotating home dinners, eight seats',
    category: 'Friends',
    members: 54,
    tier: 'INVITE_ONLY',
    joined: false,
  },
];

export const demoProfile = {
  displayName: 'Aanya',
  age: 26,
  publicShortId: 'demo-2aanya',
  neighbourhood: 'Indiranagar',
  isVerified: true,
  photosLocked: true,
  photos: [null, null, null, null, null],
  aesthetics: [null, null, null],
  handle: null,
  settings: {
    photosLocked: true,
    showVerifiedBadge: true,
    approximateDistance: true,
    pushNotifications: true,
    incognitoViewing: false,
  },
  lookingFor: ['Friends', 'Activities'],
  showMe: 'Everyone',
};

export default { gridPeople, gridMeta, pingChats, pingRequests, circleList, demoProfile };
