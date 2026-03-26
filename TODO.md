# VS Markdown Helpers

Reference repo that has all my preferred stuff in it: `/Users/byronwall/repos/vsc-jsonl-viewer`

Goals:

- Want to have a set of tools that help when viewing markdown as code and also rendering markdown as HTML
- For code view:
  - Render anything that could be a link to a file with an underline and a clickable thing that jumps to that line/spot in the file. See sample below. I want this to be fairly accomodating of relative vs. absolute links. Assume if something looks like a valid path in the repo, that it is.
  - For code blocks, offer a helper that opens the code block as a dedicated unsaved file. I want to be able to quickly view code samples outside of the markdown file - I might choose to execute them or do something else
  - I turn on line wrapping nearly alwyas but the text is subject to whatever the display widht is. It's oftne too wide. I really wnat to constrain the display width that so that text does not go beyond 96 char. This needs to work without modifying the content though. If it's possible, please implement

## Code sample to render as clickable links (the code ticks)

```sample

### 1. Executive Summary

- P0 cross-model data bleed and subscription leaks in `/client/apps/modeler/src/api-new-model-loading.ts:57-75`, `/client/apps/modeler/src/api-new-model-loading.ts:139-143`, `/client/packages/api-client/src/generated/entity-manager.tsx:329-367`, and `/client/packages/api-client/src/core/relation.ts:224-249`: identity relation channels are subscribed manually, never registered in the new subscription registry, never unsubscribed on model switch, and never resubscribed on reconnect. What is wrong: old model relation channels can remain alive while the `Relation` instance is rebound to a new model channel. How to fix: route identity relation subscriptions through the same tracked subscription API as every other relation and await cleanup during model switches.
- P1 data tables can go blank for raw-relation fallbacks in `/client/packages/api-client/src/entities/Source.ts:51-52`, `/client/packages/api-client/src/entities/Relationship.ts:181-182`, `/client/packages/api-client/src/entities/CanonicalTable.ts:42-43`, and `/client/packages/api-client/src/entities/Task.ts:53-54`: the new getters only return `DynamicRelation` entities, but several callers still legitimately fall back to raw relation IDs (`this.id` or `SQLTaskTargetRelation`). What is wrong: those IDs are not guaranteed to exist in `sys::DynamicRelationType`, so `dataRelation` becomes `undefined`. How to fix: resolve subscribed raw relations by ID, not only `DynamicRelation` entities, or add a helper that returns a relation-like wrapper for both cases.
- P1 stale datasets may stop refreshing after producer status flips back to pending because the old refetch trigger was removed from `/client/apps/modeler/src/api-new-model-loading.ts` and nothing equivalent was added to `/client/packages/api-client/src/entities/DynamicRelation.ts:77-127`. What is wrong: relation channel subscription is the documented trigger for executing stale tasks, but the new path subscribes once and then only watches producer state for presentation. How to fix: restore a pending-edge re-subscribe/refetch path or move that behavior into `DynamicRelation.ensureSubscribed`.
- P2 the unknown-channel error contract regressed between `main` `/client/apps/modeler/src/api-new-model-loading.ts:527-549` and the new `/client/packages/api-client/src/entities/DynamicRelation.ts:164-176`. What is wrong: the old helper translated missing relation channels into a specific “Missing relation channel” diagnosis; the new code flattens everything into `Relation load failed`. How to fix: preserve the special-case mapping so migration defects are distinguishable from transient transport failures.
- P2 reconnect code now cannot detect dynamic relation resubscribe failures because `/client/packages/api-client/src/entities/DynamicRelation.ts:119-126` converts subscribe exceptions into state and resolves the promise, while `/client/packages/api-client/src/generated/entity-manager.tsx:352-367` awaits that promise as if success were meaningful. What is wrong: reconnect finishes green even when relation channels are still broken. How to fix: either rethrow after storing UI state or return an explicit result object so callers can branch on failure.

```
