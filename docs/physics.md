# Layout model

GravityERD is an interactive workspace rather than a one-shot optimizer.

1. A deterministic seed creates initial positions.
2. fCoSE gives new nodes a readable collision-aware bootstrap.
3. A realtime worker continuously applies relationship contraction, rectangular node repulsion, weak gravity, domain attraction, angular fans, damping, and collision resolution.
4. Dragging a table pins it. A pinned table remains manually draggable while physics keeps it fixed at its latest position. Double-clicking toggles a table's pin without moving it. Right-drag pans the canvas.

Relationship contraction is nonlinear: long relationships contract more strongly than short relationships, while the node-size-aware minimum distance prevents connected cards from collapsing onto each other. Each physical foreign key contributes its configured group weight. Parallel foreign keys share one angular neighbor direction but still contribute individual relationship attraction.

Secondary relationships are excluded from angular fan forces. This is useful for routine audit or ownership columns that should remain visible without defining the conceptual shape of the graph.

Relationship lines are intentionally unlabeled. The arrow points from the table containing the foreign key to the referenced table. A hollow circle at the source marks a nullable foreign key. Draw.io exports connect relationships to whole table nodes, without fixed ports or waypoints, so diagrams.net can recalculate the perimeter attachment whenever a table is moved.

No final optimizer replaces the visible result. Changing a realtime parameter reheats the current layout without resetting positions or pins. The realtime controls intentionally allow broad experimental ranges, while the force step remains bounded. Continuous crossing/overlap diagnostics are not computed during normal use.

Imported numeric settings are normalized to the same finite ranges exposed by the controls. Realtime upper bounds are relationship contraction 6, contraction exponent 5, repulsion range 1000, node repulsion 8, gravity 8, node gap 200, domain attraction 4, angular fans 4, and speed 6. The advanced fCoSE bootstrap remains bounded independently; its iteration count cannot exceed 600.
