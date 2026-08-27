# Stampede Leaderboard Reliability Refactor Plan

The goal of these refactors is to make the Stampede leaderboard system more reliable by reducing situations where the browser, `localStorage`, and WordPress database disagree about the player's score, rank, identity, or synchronization state.

These refactors should be tackled **one at a time and in the order listed below**.

Do not combine them into one large refactor.

For every refactor:

1. Trace the current behavior before modifying anything.
2. Explain the exact issue you find.
3. Propose the smallest safe change.
4. Do not modify unrelated gameplay, rendering, audio, controls, or UI systems.
5. Test the change before moving to the next refactor.
6. Preserve best-score-only leaderboard behavior.
7. Preserve player names and tokens.
8. Preserve existing API routes unless there is a strong reason to change them.
9. Do not perform speculative cleanup while working on one of these items.
10. If the actual code contradicts an assumption in this document, stop and explain the discrepancy before changing behavior.

---

# 1. Remove Persistent Rank Caching

## Priority

**HIGH**

## Problem

`stampede.rider.v1` currently stores the player's leaderboard rank alongside persistent player information.

For example:

```json
{
  "name": "Boomin' Kayak",
  "token": "...",
  "score": 8680,
  "at": 1787851243372,
  "rank": 25
}
```

The problem is that `rank` is not permanent player state.

A player's score can remain unchanged while their rank changes because other players can submit new scores or improve existing scores.

For example:

```text
Player score: 8,680

Monday:
Rank #25

Tuesday:
Several players move above 8,680

Player score: still 8,680
Rank: now #31
```

The current `Board.rankOf()` can return a stored rank without contacting the server:

```js
const r = readJSON(ME, null);

if (r && r.score === score && r.rank != null) {
  return r.rank;
}
```

This means the browser can potentially display a stale rank even though the WordPress database and full leaderboard contain newer information.

## Observed Behavior

We experienced the following:

### Run 1

```text
Score: 8,680
Final calculated rank: #25
```

Opening the full leaderboard also showed:

```text
#25 — 8,680
```

There were no tied scores around this position.

### Run 2

The next run produced a lower score, approximately:

```text
7,000–7,800
```

The player's best correctly remained:

```text
8,680
```

However, the final calculated rank displayed:

```text
#21
```

Opening the full leaderboard still showed:

```text
#25 — 8,680
```

The random rank-calculation animation is NOT what was being observed. These were the final displayed ranks after calculation completed.

## Desired Behavior

Persistent rider storage should contain durable player state only.

For example:

```json
{
  "name": "Boomin' Kayak",
  "token": "...",
  "score": 8680,
  "at": 1787851243372
}
```

Do not persist current leaderboard rank as authoritative player state.

Whenever the results screen needs the player's rank:

```text
stored best score
      ↓
8,680
      ↓
GET /rank?score=8680
      ↓
server calculates CURRENT rank
      ↓
display rank
```

The server should be authoritative for current leaderboard rank.

## Important

Do NOT:

- combine `stampede.best.v1` and `stampede.rider.v1`
- change best-score behavior
- change score calculations
- change the player token
- change name claiming
- change leaderboard sorting
- change the calculating-rank animation unless necessary
- change unrelated game behavior

## Investigation Before Refactoring

Trace:

```text
syncRankRow()
    ↓
setRankFigures()
    ↓
Board.rankOf()
    ↓
localStorage
    ↓
GET /rank
    ↓
PHP rank()
    ↓
get_player_rank()
```

Identify every location where `rank` is:

- read
- written
- cleared
- returned
- displayed

Before modifying anything, report:

1. Why persistent rank caching currently exists.
2. Whether it explains the observed discrepancy.
3. Every place that depends on the cached `rank`.
4. The smallest safe change.

Then remove persistent rank caching.

---

# 2. Make Score Submission Recover From Network Failure

## Priority

**HIGH**

## Problem

`Board.submit()` currently updates the player's local best score before confirming that WordPress successfully received the score.

The current behavior is effectively:

```js
r.score = score;
writeJSON(ME, r);

fetch("/submit", ...).catch(() => {});
```

The network request is fire-and-forget.

This can create a synchronization problem.

Consider:

```text
Server best:
5,000

Local best:
5,000

Player earns:
8,680
```

The browser immediately changes localStorage to:

```text
8,680
```

Now imagine `/submit` fails because of:

- temporary Wi-Fi loss
- timeout
- server issue
- interrupted request
- browser/network error

The state becomes:

```text
Browser best = 8,680
Server best  = 5,000
```

The player then scores:

```text
8,000
```

The current code checks:

```js
8000 > 8680
```

which is false.

Therefore another submission may not occur.

The player could remain:

```text
Browser = 8,680
Server  = 5,000
```

until they eventually beat 8,680.

This contradicts the intended behavior that the server should "catch up" after a failed submission.

## Desired Behavior

The client needs a reliable way to distinguish between:

```text
local best score
```

and:

```text
server-confirmed best score
```

or maintain equivalent pending synchronization state.

One possible model is:

```json
{
  "name": "Boomin' Kayak",
  "token": "...",
  "score": 8680,
  "syncedScore": 5000,
  "at": 1787851243372
}
```

Then:

```text
local best > syncedScore
        ↓
attempt submission
        ↓
server confirms
        ↓
syncedScore = server-confirmed score
```

This is only an example architecture.

Use the smallest reliable implementation after examining the existing code.

## Required Invariant

A failed submission must eventually be retried **even if the player never beats their locally stored best score again**.

For example:

```text
Server = 5,000

Player earns 8,680
POST fails

Local = 8,680
Server = 5,000

Player later earns 7,000

System should still know:
8,680 has not been confirmed by the server

Therefore:
retry 8,680
```

## Server Behavior

The PHP side already protects the player's best score by only accepting a higher score.

Conceptually:

```sql
score = IF(
  VALUES(score) > score,
  VALUES(score),
  score
)
```

Therefore retrying an already-submitted high score should be safe.

## Do NOT

- lower server scores
- create one database row per run
- change player identity
- require the player to beat their unsynchronized score
- block the results screen indefinitely waiting for the network
- introduce a complicated offline synchronization framework if a simple retry mechanism works

## Investigation Before Refactoring

Trace:

```text
showOver()
    ↓
pendingScore
    ↓
syncRankRow()
    ↓
Board.submit()
    ↓
localStorage write
    ↓
POST /submit
    ↓
PHP submit()
    ↓
upsert_score()
```

Determine exactly what happens when the POST:

- succeeds
- fails
- times out
- succeeds after a retry

Before modifying anything, report:

1. Whether the synchronization problem described above is real.
2. What currently happens after a failed POST.
3. How the client knows—or doesn't know—that the server accepted the score.
4. The smallest reliable retry strategy.

Then implement the fix.

---

# 3. Simplify `syncRankRow()` and Make the Ranked Score Explicit

## Priority

**MEDIUM-HIGH**

## Problem

`syncRankRow()` currently relies on side effects and repeated localStorage reads.

Current structure:

```js
function syncRankRow(){
  const me = Board.me();

  if (!me){
    setRankFigures(pendingScore);
    $("fRankNote").textContent = "score not saved";
    return;
  }

  Board.submit(pendingScore);
  setRankFigures(Board.me().score);
  $("fRankNote").textContent = me.name;
}
```

This sequence effectively does:

```text
read player
    ↓
submit run
    ↓
possibly mutate localStorage
    ↓
possibly start network request
    ↓
read player AGAIN
    ↓
extract score
    ↓
request rank
```

The score being ranked is therefore implicit.

That makes asynchronous bugs and state mismatches harder to reason about.

## Desired Behavior

Make the score being ranked explicit.

Conceptually:

```js
const result = Board.recordRun(pendingScore);

setRankFigures(result.bestScore);
```

or:

```js
const bestScore = Board.bestScoreAfter(pendingScore);

Board.submitBest(bestScore);

setRankFigures(bestScore);
```

The exact function names and implementation do not matter.

The important invariant is:

> `syncRankRow()` should know exactly which score it is requesting a rank for.

Avoid using repeated localStorage reads as an indirect communication mechanism between adjacent function calls.

## Desired Flow

Something closer to:

```text
current run score
      ↓
determine local best
      ↓
best = 8,680
      ↓
attempt server synchronization
      ↓
request CURRENT rank for EXACTLY 8,680
      ↓
display result
```

If the current run is worse:

```text
Current run = 7,080
Stored best = 8,680

Rank request should explicitly use:
8,680
```

## Important

Do NOT turn this into a large leaderboard architecture rewrite.

The goal is clarity and deterministic data flow.

Before modifying anything, report:

1. Every side effect currently performed by `Board.submit()`.
2. Every storage read performed during `syncRankRow()`.
3. Which score is actually passed to `setRankFigures()`.
4. How that value could become stale or incorrect.
5. The smallest way to make the flow explicit.

Then refactor.

---

# 4. Make localStorage Writes Report Success or Failure

## Priority

**MEDIUM**

## Problem

The current storage helpers silently swallow failures.

Current behavior:

```js
const readJSON = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || d;
  } catch (e) {
    return d;
  }
};

const writeJSON = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
};
```

Gracefully surviving storage failure is good.

The problem is that callers cannot distinguish:

```text
write succeeded
```

from:

```text
write failed
```

For example, player claiming can effectively do:

```js
const rider = {...};

writeJSON(ME, rider);

return rider;
```

Even if the storage operation failed, the caller receives a successful rider object.

The server may therefore know that the player exists while the browser cannot recover that identity after a refresh.

## Desired Behavior

Storage writes should report whether they succeeded.

For example:

```js
function writeJSON(key, value){
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}
```

Important callers can then make an informed decision.

For example:

```text
player successfully claimed on server
           +
browser failed to persist token
           ↓
known degraded state
```

instead of silently assuming everything succeeded.

## Important

Storage failure should still not crash or unnecessarily prevent gameplay.

The principle should be:

> Fail gracefully, but know that you failed.

## Review These Callers

At minimum inspect:

```text
Board.claim()
Board.submit()
BEST/saveBest()
player identity restoration
any other writeJSON() caller
```

Do not automatically add user-facing error messages everywhere.

First determine which failures actually require handling.

## Before Modifying Anything

Report:

1. Every `writeJSON()` caller.
2. What happens if each write fails.
3. Which failures are harmless.
4. Which failures can create inconsistent player state.
5. Which callers should inspect the return value.

Then implement the smallest appropriate change.

---

# 5. Distinguish an Empty Leaderboard From a Failed Leaderboard Request

## Priority

**MEDIUM**

## Problem

`Board.top()` currently converts a network failure into an empty array.

Conceptually:

```js
async top(n){
  try {
    const res = await timeoutFetch(...);

    if (!res.ok) return [];

    return await res.json();

  } catch (e) {
    return [];
  }
}
```

As a result, these two states are indistinguishable:

```text
Leaderboard successfully loaded:
0 players
```

and:

```text
Leaderboard actually contains players:
network request failed
```

`renderBoard()` sees:

```js
rows.length === 0
```

and can therefore make a failed request look like a legitimate empty leaderboard.

## Desired Behavior

Return enough information to distinguish success from failure.

For example:

```js
{
  ok: true,
  rows: []
}
```

versus:

```js
{
  ok: false,
  rows: []
}
```

The exact structure can differ if another approach fits the existing code better.

Then the UI can display:

```text
No scores yet.
```

for a legitimately empty leaderboard.

And:

```text
Couldn't load leaderboard.
Try again.
```

for a failed request.

## Also Review

Apply the same principle to other API helpers where appropriate:

```text
rank
names
submit
claim
```

Do not create unnecessary complexity.

The core principle is:

> Do not represent network failure as valid application data.

## Before Modifying Anything

Report:

1. Which Board API methods currently swallow network failures.
2. What fallback value each returns.
3. Whether that fallback can be mistaken for legitimate data.
4. Which cases actually need to distinguish failure from empty/valid data.

Then refactor only the cases where the distinction matters.

---

# 6. Make the Name Lists Have One Source of Truth

## Priority

**MEDIUM / LONGER-TERM**

## Problem

The valid name arrays exist independently in:

```text
index.html
```

and:

```text
class-name-pool.php
```

The PHP code itself warns that these lists must manually remain synchronized.

If somebody adds:

```js
"Rootin'"
```

to the JavaScript list but forgets PHP, the browser can generate:

```text
Rootin' Mustang
```

while the server rejects that same name as invalid.

This is another two-sources-of-truth problem.

## Desired Behavior

Have one authoritative source for:

```text
NAME_A
NAME_B
BAD_NUM
```

Possible solutions include:

## Option A — Server Authoritative

Expose valid naming options through an endpoint such as:

```text
GET /name-options
```

returning something like:

```json
{
  "adjectives": [...],
  "nouns": [...]
}
```

The browser then uses those lists instead of maintaining an independent copy.

## Option B — Shared/Generated Configuration

Maintain one configuration source from which both the JavaScript and PHP representations are generated.

Either approach is acceptable.

Choose whichever solution introduces the least unnecessary complexity into this project.

## Important

Do not refactor this until the higher-priority leaderboard reliability work is stable.

The duplicated lists currently work as long as they remain synchronized.

This is preventative maintenance rather than evidence of the current rank bug.

## Before Modifying Anything

Report:

1. Where each copy of the lists exists.
2. Whether they currently match exactly.
3. Which side should logically own the authoritative list.
4. Whether an API request during boot would create undesirable dependencies.
5. The simplest way to establish one source of truth.

Then wait for approval before implementing this refactor.

---

# 7. Audit Derived State vs Persistent State

## Priority

**MEDIUM / ARCHITECTURAL CLEANUP**

## Goal

Use the rank bug as an opportunity to identify anything else being persisted that should actually be calculated, fetched, or treated as temporary state.

Use the following general model.

## Persist Durable Local State

Examples:

```text
player token
player name
local personal best
local gameplay records
pending unsynchronized score
```

## Let the Server Own Shared/Live State

Examples:

```text
server-confirmed leaderboard score
leaderboard entries
current player rank
taken names
```

## Calculate Derived State When Needed

Examples:

```text
current rank
whether player is top 50
current leaderboard position
UI labels
loading state
```

Do not persist something simply because recalculating or requesting it is inconvenient.

## Audit These Keys

At minimum:

```text
stampede.best.v1
stampede.rider.v1
```

For every property, classify it as one of:

```text
Durable local state
Server state
Derived state
Temporary UI state
Synchronization state
```

Create a table such as:

| Property | Current Storage | Classification | Should Persist? | Authority |
|---|---|---|---|---|
| `name` | rider | Durable identity | Yes | Server/local |
| `token` | rider | Durable identity | Yes | Server |
| `score` | rider | Needs review | Yes | Depends on sync design |
| `rank` | rider | Derived/live | No | Server |
| `coins` | best | Local gameplay record | Yes | Local |

Complete the actual table from the code rather than assuming the examples above are exhaustive.

## Before Modifying Anything

First provide the complete audit.

Do not automatically refactor every questionable property.

For each questionable property explain:

1. Why it currently exists.
2. Who should own it.
3. Whether persistence is necessary.
4. What could break if it is removed.
5. Whether changing it provides a meaningful reliability benefit.

Then we can decide which additional changes are worth making.

---

# Recommended Refactor Order

Complete these separately:

```text
1. Remove persistent rank caching
             ↓
2. Reliable score synchronization/retry
             ↓
3. Simplify syncRankRow()
             ↓
4. Storage success/failure reporting
             ↓
5. Network error vs empty-data handling
             ↓
6. Single source of truth for name lists
             ↓
7. General persistent-state audit
```

Do not start the next refactor until the previous one has been tested and confirmed stable.

Each refactor should ideally be its own commit.

Suggested commit structure:

```text
refactor: remove persistent leaderboard rank cache

refactor: make score submission recoverable

refactor: simplify results rank synchronization

refactor: report local storage failures

refactor: distinguish leaderboard request failures

refactor: centralize leaderboard name options

refactor: clean up persisted leaderboard state
```

---

# Testing Requirements After Every Refactor

At minimum test the following scenarios after any leaderboard/storage change.

---

## Test 1 — New Player

```text
Claim name
    ↓
Play first run
    ↓
Score submits
    ↓
Rank appears
    ↓
Leaderboard contains player
    ↓
Reload page
    ↓
Player identity survives
```

Verify:

- name is correct
- token survives
- score is correct
- rank matches the leaderboard
- refresh does not create another player

---

## Test 2 — Better Score

Starting state:

```text
Existing best: 5,000
```

New run:

```text
8,680
```

Expected:

```text
Local best = 8,680
Server best = 8,680
Rank calculated using 8,680
Leaderboard displays 8,680
```

Refresh the page and verify the same state remains.

---

## Test 3 — Worse Score

Starting state:

```text
Existing best: 8,680
```

New run:

```text
7,080
```

Expected:

```text
Current run score = 7,080
Leaderboard best = 8,680
Server best = 8,680
Rank request uses = 8,680
```

The results screen may display the current run's 7,080 score where appropriate, but leaderboard ranking must continue to use the player's 8,680 best.

The lower run must never overwrite 8,680.

---

## Test 4 — Failed Score Submission

Simulate:

```text
Existing server best: 5,000
New run: 8,680
POST /submit fails
```

Expected local state should recognize that:

```text
Local best = 8,680
Server-confirmed best = 5,000
8,680 still needs synchronization
```

Restore connectivity.

Verify that 8,680 eventually reaches the server **without requiring the player to beat 8,680 again**.

Then verify:

```text
Server best = 8,680
Local best = 8,680
No submission remains pending
```

---

## Test 5 — Rank Changes Without Player Score Changing

Starting state:

```text
Player score = 8,680
Current rank = #25
```

Change another player's database score from below the player:

```text
8,000
```

to above the player:

```text
9,000
```

The player's score remains:

```text
8,680
```

Revisit the rank/results UI.

Expected:

```text
Player score = 8,680
Current rank = #26
```

The application must retrieve the new current rank.

No stale local rank should override the database.

---

## Test 6 — Worse Run After Rank Movement

This specifically tests the bug pattern we experienced.

Starting state:

```text
Best score = 8,680
Rank = #25
```

Change the leaderboard so the player's current rank becomes:

```text
#26
```

Then play another run and score:

```text
7,000
```

Expected:

```text
Current run score = 7,000
Best score = 8,680
Rank request score = 8,680
Current rank = #26
```

The system must NOT show the previously cached #25.

---

## Test 7 — Leaderboard vs Results Rank

Whenever the results screen displays:

```text
Rank #X
```

open the full leaderboard immediately afterward.

For a player visible within the returned leaderboard range, verify that the player's position agrees with the ranking rules used by `/rank`.

If the two disagree, investigate before proceeding.

Do not assume one screen is correct.

---

## Test 8 — Network Failure

Test failures for:

```text
/rank
/leaderboard
/submit
/names
/claim
```

Verify each failure:

- does not crash the game
- does not masquerade as valid data
- does not corrupt player identity
- does not overwrite a valid best score
- does not create duplicate players
- can recover when connectivity returns

---

## Test 9 — localStorage Failure

Simulate unavailable or throwing localStorage.

Verify:

```text
Game remains playable
```

but also verify the code correctly recognizes that player state could not be persisted.

Make sure a failed storage write is not silently treated as a confirmed successful write where persistence is required.

---

## Test 10 — Rapid Back-to-Back Runs

Play two runs close together.

Example:

```text
Run 1:
8,680

Run 2:
9,200
```

Then reverse the pattern:

```text
Run 1:
9,200

Run 2:
7,000
```

Look specifically for asynchronous race conditions involving:

```text
Board.submit()
Board.rankOf()
setRankFigures()
localStorage writes
pendingScore
rankRequestId
```

A response from an older request must not overwrite newer player state.

---

# Core Reliability Principle

The leaderboard should follow this model:

```text
LOCAL STORAGE
============

Who am I?

What is my local best?

What data still needs to synchronize?


        ↓ synchronization


SERVER / DATABASE
=================

What score has actually been accepted?

Who else is on the leaderboard?

What is my CURRENT rank?

Which names are currently claimed?


        ↓ current data


UI
==

Display those facts.

Do not invent or permanently cache shared/live facts.
```

The primary goal of these refactors is to reduce the number of places that can independently believe different versions of the same fact.

---

# General Refactoring Rule

Do not rewrite the leaderboard architecture just because some of this code can be cleaner.

The current system already has important working behavior:

- persistent player identity
- unique tokens
- claimed names
- best-score-only submissions
- server-side score protection
- leaderboard retrieval
- rank calculation
- results integration
- graceful gameplay when the network is unavailable

Preserve those behaviors.

The goal is:

> **Make the existing system more deterministic and reliable, not replace it with a new system.**

Whenever possible, prefer:

```text
one authoritative source
+
explicit state
+
small functions
+
observable failures
+
safe retries
```

over:

```text
duplicated state
+
implicit side effects
+
silent failures
+
persistent derived values
```

Tackle each numbered refactor independently and verify it before proceeding to the next one.