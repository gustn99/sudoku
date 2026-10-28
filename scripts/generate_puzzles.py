#!/usr/bin/env python3
"""Create a bundled, reproducible set of Sudoku puzzles with unique solutions."""
import json
import random
from pathlib import Path

RNG = random.Random(20261028)
ROOT = Path(__file__).resolve().parents[1]
TARGETS = {"beginner": 40, "intermediate": 34, "advanced": 29, "master": 25}
BIT_COUNTS = [bin(i).count("1") for i in range(1024)]
UNITS = (
    [[r * 9 + c for c in range(9)] for r in range(9)]
    + [[r * 9 + c for r in range(9)] for c in range(9)]
    + [[(br + r) * 9 + bc + c for r in range(3) for c in range(3)] for br in (0, 3, 6) for bc in (0, 3, 6)]
)
PEERS = [set().union(*(set(unit) for unit in UNITS if i in unit)) - {i} for i in range(81)]


def solved_grid():
    base = lambda r, c: (r * 3 + r // 3 + c) % 9
    bands = RNG.sample(range(3), 3)
    stacks = RNG.sample(range(3), 3)
    rows = [b * 3 + r for b in bands for r in RNG.sample(range(3), 3)]
    cols = [s * 3 + c for s in stacks for c in RNG.sample(range(3), 3)]
    digits = RNG.sample("123456789", 9)
    return "".join(digits[base(r, c)] for r in rows for c in cols)


def solution_count(puzzle, limit=2):
    rows, cols, boxes = [0] * 9, [0] * 9, [0] * 9
    grid = [int(ch) for ch in puzzle]
    for i, n in enumerate(grid):
        if n:
            bit = 1 << n
            r, c, b = i // 9, i % 9, (i // 27) * 3 + (i % 9) // 3
            if (rows[r] | cols[c] | boxes[b]) & bit:
                return 0
            rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit
    count = 0

    def search():
        nonlocal count
        best, options, size = -1, 0, 10
        for i, n in enumerate(grid):
            if n:
                continue
            r, c, b = i // 9, i % 9, (i // 27) * 3 + (i % 9) // 3
            mask = 0x3fe & ~(rows[r] | cols[c] | boxes[b])
            bits = BIT_COUNTS[mask]
            if bits == 0:
                return
            if bits < size:
                best, options, size = i, mask, bits
                if bits == 1:
                    break
        if best == -1:
            count += 1
            return
        r, c, b = best // 9, best % 9, (best // 27) * 3 + (best % 9) // 3
        while options and count < limit:
            bit = options & -options
            options -= bit
            grid[best] = bit.bit_length() - 1
            rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit
            search()
            rows[r] ^= bit; cols[c] ^= bit; boxes[b] ^= bit
            grid[best] = 0

    search()
    return count


def make_puzzle(solution, target):
    cells = list(solution)
    order = list(range(81))
    RNG.shuffle(order)
    clues = 81
    for i in order:
        if clues <= target:
            break
        old = cells[i]
        cells[i] = "0"
        if solution_count("".join(cells)) != 1:
            cells[i] = old
        else:
            clues -= 1
    return "".join(cells), clues


def basic_solver_rating(puzzle):
    """Return hidden-single moves and cells left after naked/hidden singles."""
    grid = [int(value) for value in puzzle]
    hidden = 0
    while 0 in grid:
        candidates = [set(range(1, 10)) - {grid[j] for j in PEERS[i]} if not grid[i] else set() for i in range(81)]
        move = next(((i, next(iter(options))) for i, options in enumerate(candidates) if len(options) == 1), None)
        if move is None:
            for unit in UNITS:
                for number in range(1, 10):
                    cells = [i for i in unit if number in candidates[i]]
                    if len(cells) == 1:
                        move = (cells[0], number)
                        hidden += 1
                        break
                if move is not None:
                    break
        if move is None:
            break
        grid[move[0]] = move[1]
    return hidden, grid.count(0)


def matches_level(level, puzzle):
    hidden, remaining = basic_solver_rating(puzzle)
    if level == "beginner":
        return hidden == 0 and remaining == 0
    if level == "intermediate":
        return hidden > 0 and remaining == 0
    if level == "advanced":
        return 20 <= remaining < 40
    return remaining >= 40


def main():
    result = {key: [] for key in TARGETS}
    seen = set()
    for level, target in TARGETS.items():
        attempts = 0
        while len(result[level]) < 100:
            attempts += 1
            if attempts > 12000:
                raise RuntimeError(f"Could not make enough {level} puzzles")
            solution = solved_grid()
            puzzle, clues = make_puzzle(solution, target)
            if puzzle in seen or clues > target + 2 or not matches_level(level, puzzle):
                continue
            seen.add(puzzle)
            result[level].append({"puzzle": puzzle, "solution": solution})
        print(level, len(result[level]), "attempts", attempts)
    output = ROOT / "data" / "puzzles.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(output, output.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
