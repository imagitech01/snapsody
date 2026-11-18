"""Where the staffs of a page are and what homr made of its time signature.
instrument_assist patch, see vendor/PATCHES.md (patch 8).

process_image() fills a PageLayout when it is given one. It is reported next to the
MusicXML and never changes it: the MusicXML is byte-identical with and without it.
Only the first voice (the first part) is described, in reading order.
"""

from dataclasses import dataclass, field

# x, y, width, height in pixels of the image given to homr
Box = tuple[float, float, float, float]


@dataclass
class PageLayout:
    # The box of each system (the union of its staffs, staff lines only: no ledger lines,
    # stems or text) that gave symbols to the first voice, in reading order
    staff_boxes: list[Box] = field(default_factory=list)
    # How many measures of the first part each of those systems gave
    bars_per_staff: list[int] = field(default_factory=list)
    # How many measures the first part has
    bars: int = 0
    # True when no time signature was read at the start of the page and homr wrote its
    # n/4 estimate from the median measure length instead
    time_estimated: bool = False

    def staves(self) -> list[dict] | None:
        """
        The staffs with their measures, numbered from 1 on this page, or None when the
        counts don't fit: a system without measures of its own, or not one count per box.
        """
        if not self.staff_boxes or len(self.staff_boxes) != len(self.bars_per_staff):
            return None
        if any(count <= 0 for count in self.bars_per_staff) or sum(self.bars_per_staff) != self.bars:
            return None
        result = []
        first = 1
        for box, count in zip(self.staff_boxes, self.bars_per_staff, strict=True):
            result.append({"box": box, "firstBar": first, "lastBar": first + count - 1})
            first += count
        return result
