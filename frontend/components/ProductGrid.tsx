import { ProductCard } from "./ProductCard"

const products = [
  {
    id: 1,
    title: "Galaxy S23 Ultra",
    price: 999.99,
    originalPrice: 1199.99,
    image: "/placeholder.svg",
    discount: 15,
    rating: 4.5,
  },
  {
    id: 2,
    title: "Galaxy M13",
    price: 299.99,
    originalPrice: 349.99,
    image: "/placeholder.svg",
    discount: 10,
    rating: 4.2,
  },
  {
    id: 3,
    title: "iPhone 14 Pro Max",
    price: 1099.99,
    originalPrice: 1299.99,
    image: "/placeholder.svg",
    discount: 15,
    rating: 4.8,
  },
  {
    id: 4,
    title: "OnePlus 11",
    price: 699.99,
    originalPrice: 799.99,
    image: "/placeholder.svg",
    discount: 12,
    rating: 4.4,
  },
  {
    id: 5,
    title: "Pixel 7 Pro",
    price: 849.99,
    originalPrice: 999.99,
    image: "/placeholder.svg",
    discount: 15,
    rating: 4.6,
  },
]

export function ProductGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((product) => (
        <ProductCard key={product.id} {...product} />
      ))}
    </div>
  )
}

