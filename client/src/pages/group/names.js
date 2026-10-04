// [{ name: 'Ana' }, { name: 'Ben' }, { name: 'Cal' }] -> "Ana, Ben and Cal"
// With `meId`, the viewer is listed first as "you": "you and Cal".
export function names(people, meId) {
  const me = people.filter((person) => person.userId === meId);
  const others = people.filter((person) => person.userId !== meId);
  const list = [...me.map(() => 'you'), ...others.map((person) => person.name)];
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}
