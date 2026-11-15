---
description: Build structurally different UI variants of a page or component, switchable from a floating panel, to pick a design by looking at it.
argument-hint: "[count] <page, route or component> [notes]"
disable-model-invocation: true
---

Build throwaway UI variants of what the arguments name, switchable from a floating panel in the browser, so the user can pick a design by looking at it. Arguments: $ARGUMENTS

**Read the arguments.** A leading number is how many variants to build: default 5, at least 2. The rest names what to prototype (a page, a route, a component, or a section that does not exist yet) and anything the variants must keep or explore. If nothing is named, ask what to prototype and stop.

**Find the stack and the host page.** Work out the project's UI stack from its code: the framework, or none; the router; the styling system and component library; how the dev server starts. Build everything in that stack's own idiom. Nothing here assumes a particular framework, and no new dependency is needed.

Render the variants inside the real page they are for, with its real layout, data and density, because a variant judged on an empty page always looks fine. Something new that would live inside an existing page (a section, a card, a step in a flow) is mounted in that page. Only when nothing is a natural host, add a throwaway route that follows the project's routing convention, with `prototype` in its path.

**Build the variants.** First write a one-line plan as a comment at the top of the switcher: what is prototyped, how many variants, on which route. Then:

- Key the variants `A`, `B`, `C`… and give each a short name for its idea, such as `Sidebar nav` or `Single-column wizard`.
- Make them structurally different: layout, information hierarchy, primary action, navigation. Colour, copy and spacing alone do not count. If two drafts come out alike, redo one under an explicit "not that" constraint. Sharing a small piece such as a header is fine; sharing the layout defeats the point.
- Give every variant the same purpose and data, built with the project's own components and styling.
- When the thing already exists, keep its current rendering as an extra first entry, `current · Current`, not counted in the number, so every variant is judged against what is there today.
- Keep it read-only: the page's existing data fetching stays above the switch, and anything that would write goes to a stub.
- Skip the polish: no tests, no error handling beyond what makes it render, no abstractions.
- Put the files next to the page they are for, with `prototype` in their names. Keep the variant list (key, name, component) in one place, so adding, dropping or renaming a variant is a one-line change.

Mount only the variant on screen, through a conditional in the page. A page without a client-side framework may render every variant and let the panel show one at a time.

**Build the floating panel** as one self-contained file in the same stack: a component of the project's framework, or a plain script where there is none. It sits fixed at the bottom centre, above everything, takes no layout space, and looks plainly unlike the page, such as a dark, high-contrast pill with a shadow, so no one judges it as part of the design. Keep its styles and the page's apart in both directions.

- **Collapsed**, the default: a previous arrow; the current variant's key and name, with its position among the checked ones (`C · Sidebar nav · 2/4`); a next arrow; and a toggle that opens the list.
- **Expanded**: a list above the pill, one row per variant, each with a checkbox, its key and its name. Clicking a name shows that variant, checked or not. `Esc` closes the list.
- **Navigation**: the arrows, and the `←` `→` keys, step only through checked variants, in list order, wrapping around. Ignore the keys while a modifier is held or focus is in an input, textarea, select or contenteditable element.
- **Unchecking**: the variant on screen stays on screen when unchecked, and the next step leaves it for the nearest checked one. The last checked variant cannot be unchecked. With only one checked, the arrows are disabled.
- **The URL holds the state**, so a reload keeps it and a copied link opens the same view: `?variant=<key>` for the variant on screen, and `&shortlist=<keys,comma-separated>` for the checked ones, left out while all are checked. A missing or unknown key falls back to the first checked variant. Update the URL without reloading the page: with the router's replace where the project has a router, with `history.replaceState` otherwise. Keep the page's other query parameters.
- **Development only**: gate the panel and the variant switch on the stack's own development check, such as `import.meta.env.DEV`, `process.env.NODE_ENV !== 'production'` or a debug setting. A production build then renders the page as it did before.

**Run no checks while prototyping.** Until the user picks a winner, run no tests, linters, type-checks or builds: not after the first build, and not after a change. The dev server shows whether a variant renders, and the checks are for the final version only. This holds even where the repository's own instructions say to run them after every change.

**Hand it over.** Give the URL, the command that starts the dev server if it is not running, and the variants, one line each: key, name, and what sets it apart.

Iterate on feedback such as "the header from B with the list from D": change, add or drop variants as asked, keeping the panel's list in step. Create no branches, commits, issues or pull requests.

**When the user picks a winner**, and only then, fold it into the real page and bring it up to the project's standard, since it was written without tests or error handling. Delete the other variants, the switcher and the panel, and list the files removed. Now run the project's tests, linters and checks, as the repository finishes any change.
