/** Системный пользователь @zero защищён от блокировки и звонков. */
export function isZeroIdentity(input: {
  id?: string;
  username?: string;
  email?: string;
}): boolean {
  if (input.id === "c_zero") return true;
  const username = (input.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (username === "zero") return true;
  return (input.email ?? "").trim().toLowerCase() === "zero@gmail.com";
}
