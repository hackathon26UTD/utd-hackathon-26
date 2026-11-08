# Choosing an observation view

A view is a read-only filter over the latest recorded observations. Choose 1 to 3 of the fixed filter names and say whether they combine with all or any.

- "all" keeps boxes that match every chosen filter. "any" keeps boxes that match at least one.
- Choose the most specific filters for the question. Do not invent names. If no filter fits, choose the closest supported one and explain the limit in the summary.
- The model only picks names. The server computes the matches from recorded values and returns the evidence.
- "Boxes that are safe" or "empty homes" or "damaged homes" are not supported. Say so and offer the nearest supported view, such as stale or critical.
- Cite external context ids only when a supplied record was used. Use an empty list otherwise.
