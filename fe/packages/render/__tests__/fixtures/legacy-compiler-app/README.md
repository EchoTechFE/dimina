# Legacy compiler compatibility fixture

This mini-program fixture exercises the property-binding protocol emitted by
the unmodified compiler at commit `0a85e77156b4e28dd62377e1e2ea268d9eb6db2c`.
That output contains `v-c-prop-bindings`, but no create-time
`dimina-prop-bindings`, ownership metadata, or Service-side WXS module records.

The compatibility probe builds this source with that pinned compiler and runs
the resulting files unchanged in the current Container, Render, and Service
runtime. It covers:

- a simple data property;
- a compound expression;
- a WXS property expression;
- `wx:for` item and index properties;
- property observers in the Service runtime;
- an event-driven `setData` update after initial render.

Expected visible values:

```text
initial:
2|5|4|0|0 /seen:2|5|4|-1|-1
0|0|0|7|0 /seen:-1|-1|-1|7|-1
0|0|0|11|1 /seen:-1|-1|-1|11|1

after update:
4|10|8|0|0 /seen:4|10|8|-1|-1
0|0|0|13|0 /seen:-1|-1|-1|13|-1
0|0|0|17|1 /seen:-1|-1|-1|17|1
```
