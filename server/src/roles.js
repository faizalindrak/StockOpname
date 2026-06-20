/** Role vocabulary: DB and API both use `admin` | `user`. */

export function roleToDb(role) {
  if (role === "counter") return "user";
  return role || "user";
}

export function roleFromDb(role) {
  return role;
}

export function mapUserRole(user) {
  if (!user) return user;
  return { ...user, role: roleFromDb(user.role) };
}