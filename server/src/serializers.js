// Shapes database rows into API responses. Shared by every route that returns members or sessions,
// so the rule "other members see names and roles only, never emails or time zones" lives in one place.

const memberInclude = { user: { select: { id: true, name: true } } };

// Enum order puts ORGANIZER first, then members in the order they joined.
const memberOrder = [{ role: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }];

function toMember(membership) {
  return {
    userId: membership.user.id,
    name: membership.user.name,
    role: membership.role,
    required: membership.required,
    joinedAt: membership.joinedAt,
    availabilityUpdatedAt: membership.availabilityUpdatedAt,
  };
}

function toSession(session) {
  if (!session) return null;
  const { startMinute, durationMinutes, confirmedAt } = session;
  return { startMinute, durationMinutes, confirmedAt };
}

module.exports = { memberInclude, memberOrder, toMember, toSession };
