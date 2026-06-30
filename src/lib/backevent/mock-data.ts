import type {
  Location,
  OpeningClosingStatus,
  Product,
  StockBalance,
  StockMovement,
  StockStatus,
} from "./types";

export const locations: Location[] = [
  { id: "blaa-container", name: "Blå Container (Hovedlager)", kind: "container" },
  { id: "roed-container", name: "Rød Container", kind: "container" },
  { id: "groen-container", name: "Grøn Container", kind: "container" },
  { id: "pub-container", name: "Pub Container", kind: "bar" },
  { id: "street-container", name: "Street Container", kind: "bar" },
];

export const products: Product[] = [
  { id: "tuborg-33", name: "Tuborg 33 cl", unit: "kasser", lowThreshold: 16, criticalThreshold: 8 },
  { id: "tuborg-classic", name: "Tuborg Classic", unit: "kasser", lowThreshold: 12, criticalThreshold: 6 },
  { id: "pepsi-max", name: "Pepsi Max", unit: "kasser", lowThreshold: 10, criticalThreshold: 5 },
  { id: "faxe-kondi", name: "Faxe Kondi", unit: "kasser", lowThreshold: 10, criticalThreshold: 5 },
  { id: "vand", name: "Vand", unit: "kasser", lowThreshold: 14, criticalThreshold: 7 },
  { id: "somersby", name: "Somersby", unit: "kasser", lowThreshold: 8, criticalThreshold: 4 },
  { id: "fadoel-25l", name: "Fadøl 25L", unit: "fustager", lowThreshold: 5, criticalThreshold: 2 },
];

export const stockBalances: StockBalance[] = [
  { locationId: "blaa-container", productId: "tuborg-33", quantity: 96 },
  { locationId: "blaa-container", productId: "tuborg-classic", quantity: 54 },
  { locationId: "blaa-container", productId: "pepsi-max", quantity: 38 },
  { locationId: "blaa-container", productId: "faxe-kondi", quantity: 42 },
  { locationId: "blaa-container", productId: "vand", quantity: 64 },
  { locationId: "blaa-container", productId: "somersby", quantity: 24 },
  { locationId: "blaa-container", productId: "fadoel-25l", quantity: 18 },
  { locationId: "roed-container", productId: "tuborg-33", quantity: 18 },
  { locationId: "roed-container", productId: "tuborg-classic", quantity: 9 },
  { locationId: "roed-container", productId: "pepsi-max", quantity: 7 },
  { locationId: "roed-container", productId: "faxe-kondi", quantity: 11 },
  { locationId: "roed-container", productId: "vand", quantity: 16 },
  { locationId: "roed-container", productId: "somersby", quantity: 6 },
  { locationId: "roed-container", productId: "fadoel-25l", quantity: 3 },
  { locationId: "groen-container", productId: "tuborg-33", quantity: 8 },
  { locationId: "groen-container", productId: "tuborg-classic", quantity: 5 },
  { locationId: "groen-container", productId: "pepsi-max", quantity: 4 },
  { locationId: "groen-container", productId: "faxe-kondi", quantity: 8 },
  { locationId: "groen-container", productId: "vand", quantity: 11 },
  { locationId: "groen-container", productId: "somersby", quantity: 3 },
  { locationId: "groen-container", productId: "fadoel-25l", quantity: 2 },
  { locationId: "pub-container", productId: "tuborg-33", quantity: 12 },
  { locationId: "pub-container", productId: "tuborg-classic", quantity: 10 },
  { locationId: "pub-container", productId: "pepsi-max", quantity: 6 },
  { locationId: "pub-container", productId: "faxe-kondi", quantity: 5 },
  { locationId: "pub-container", productId: "vand", quantity: 10 },
  { locationId: "pub-container", productId: "somersby", quantity: 7 },
  { locationId: "pub-container", productId: "fadoel-25l", quantity: 4 },
  { locationId: "street-container", productId: "tuborg-33", quantity: 22 },
  { locationId: "street-container", productId: "tuborg-classic", quantity: 12 },
  { locationId: "street-container", productId: "pepsi-max", quantity: 14 },
  { locationId: "street-container", productId: "faxe-kondi", quantity: 18 },
  { locationId: "street-container", productId: "vand", quantity: 20 },
  { locationId: "street-container", productId: "somersby", quantity: 6 },
  { locationId: "street-container", productId: "fadoel-25l", quantity: 5 },
];

export const recentMovements: StockMovement[] = [
  {
    id: "move-1",
    quantity: 10,
    unit: "kasser",
    productId: "tuborg-33",
    fromLocationId: "blaa-container",
    toLocationId: "pub-container",
    createdAt: "2026-06-28T13:40:00+02:00",
    createdBy: "Mette",
  },
  {
    id: "move-2",
    quantity: 4,
    unit: "kasser",
    productId: "pepsi-max",
    fromLocationId: "blaa-container",
    toLocationId: "roed-container",
    createdAt: "2026-06-28T13:10:00+02:00",
    createdBy: "Jonas",
  },
  {
    id: "move-3",
    quantity: 6,
    unit: "kasser",
    productId: "tuborg-33",
    fromLocationId: "roed-container",
    toLocationId: "groen-container",
    createdAt: "2026-06-28T12:45:00+02:00",
    createdBy: "Lise",
  },
  {
    id: "move-4",
    quantity: 12,
    unit: "kasser",
    productId: "faxe-kondi",
    fromLocationId: "blaa-container",
    toLocationId: "street-container",
    createdAt: "2026-06-28T12:15:00+02:00",
    createdBy: "Peter",
  },
  {
    id: "move-5",
    quantity: 8,
    unit: "kasser",
    productId: "tuborg-33",
    fromLocationId: "pub-container",
    toLocationId: "blaa-container",
    createdAt: "2026-06-28T11:50:00+02:00",
    createdBy: "Anne",
  },
];

export const openingClosingStatuses: OpeningClosingStatus[] = [
  {
    id: "status-1",
    type: "opening",
    locationId: "pub-container",
    createdAt: "2026-06-28T09:00:00+02:00",
    createdBy: "Mette",
    counts: [
      { productId: "tuborg-33", quantity: 20 },
      { productId: "tuborg-classic", quantity: 14 },
      { productId: "fadoel-25l", quantity: 5 },
    ],
  },
  {
    id: "status-2",
    type: "closing",
    locationId: "roed-container",
    createdAt: "2026-06-27T23:20:00+02:00",
    createdBy: "Jonas",
    counts: [
      { productId: "pepsi-max", quantity: 7 },
      { productId: "faxe-kondi", quantity: 11 },
      { productId: "vand", quantity: 16 },
    ],
  },
];

export function getLocation(id: string) {
  return locations.find((location) => location.id === id);
}

export function getProduct(id: string) {
  return products.find((product) => product.id === id);
}

export function getLocationStock(locationId: string) {
  return products.map((product) => ({
    product,
    balance: stockBalances.find(
      (item) => item.locationId === locationId && item.productId === product.id,
    )?.quantity ?? 0,
  }));
}

export function getLocationTotal(locationId: string) {
  return getLocationStock(locationId).reduce((sum, item) => sum + item.balance, 0);
}

export function getStockStatus(locationId: string): StockStatus {
  const stock = getLocationStock(locationId);
  const hasCritical = stock.some((item) => item.balance <= item.product.criticalThreshold);
  const hasLow = stock.some((item) => item.balance <= item.product.lowThreshold);

  if (hasCritical) {
    return "critical";
  }

  if (hasLow) {
    return "low";
  }

  return "good";
}

export function getFillPercentage(locationId: string) {
  const total = getLocationTotal(locationId);
  return Math.min(100, Math.round((total / 260) * 100));
}
