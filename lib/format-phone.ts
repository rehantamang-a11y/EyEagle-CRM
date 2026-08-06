export function formatIndianPhone(value?: string | null) {
  if (!value) return "Phone not provided";
  const digits = value.replace(/\D/g, "");
  const nationalNumber = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits.length === 11 && digits.startsWith("0")
      ? digits.slice(1)
      : digits;
  if (nationalNumber.length !== 10) return value;
  return `+91 ${nationalNumber.slice(0, 5)} ${nationalNumber.slice(5)}`;
}
