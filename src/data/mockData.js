export const store = {
  name: 'thecoffeerealm', branch: 'North Fairview',
  address: 'Lot 1 Block 210 Mark Street corner Dollar Street, Quezon City, Philippines, 1121',
  phone: '+63 997 533 7958', email: 'main.thecoffeerealm@gmail.com',
  facebook: 'https://www.facebook.com/thecoffeerealmx', instagram: 'https://www.instagram.com/thecoffeerealmx',
  map: 'https://www.google.com/maps/search/?api=1&query=The+Coffee+Realm+North+Fairview',
}

// Names, categories and images come from the legacy catalog. Only prices explicitly present in source are included.
export const menuItems = [
  { id: 1, name: 'Espresso Blend', category: 'Espresso', description: 'Bold, rich, and perfect for full-bodied espresso shots.', price: 155, image: '/images/espressoblend.jpg', badge: 'Legacy favorite' },
  { id: 2, name: 'Iced Americano', category: 'Espresso', description: 'Balanced chocolate notes ideal for daily sipping.', price: 145, image: '/images/iceamericano.jpg', badge: 'Classic' },
  { id: 3, name: 'Machiato', category: 'Espresso', description: 'Silky smooth concentrate brewed low and slow.', price: 170, image: '/images/machiato.jpg', badge: 'Coffee staple' },
  { id: 4, name: 'Biscoff Latte', category: 'TCR Specials', image: '/images/menu/BiscoffLatte.png' },
  { id: 5, name: 'Black Sesame Matcha Latte', category: 'TCR Specials', image: '/images/menu/BlackSesameMatchaLatte.jpg' },
  { id: 6, name: 'Hojicha Coconut Cloud', category: 'TCR Specials', image: '/images/menu/HojichaCoconutCloud.png' },
  { id: 7, name: 'Taho Latte', category: 'TCR Specials', image: '/images/menu/TahoLatte.jpg' },
  { id: 8, name: 'Spanish Latte', category: 'Espresso', image: '/images/menu/SpanishLatte.jpg' },
  { id: 9, name: 'Sea Salt Latte', category: 'Espresso', image: '/images/menu/SeasaltLatte.jpg' },
  { id: 10, name: 'Matcha Latte', category: 'Non-Coffee', image: '/images/menu/MatchaLatte.jpg' },
  { id: 11, name: 'Thai Milk Tea', category: 'Non-Coffee', image: '/images/menu/ThaiMilktea.jpg' },
  { id: 12, name: 'Strawberry Milk', category: 'Non-Coffee', image: '/images/menu/StrawberryMilk.jpg' },
  { id: 13, name: 'Beef Tapa', category: 'Meals', image: '/images/menu/BeefTapa.jpg' },
  { id: 14, name: 'Katsu Curry', category: 'Meals', image: '/images/menu/KatsuCurry.jpg' },
  { id: 15, name: 'Sampler Box 6', category: 'Cookies', image: '/images/sampler_box_6.JPG' },
  { id: 16, name: 'Burnt Basque Cheesecake', category: 'Cakes', image: '/images/menu/BurntBasqueCheesecake.jpg' },
  { id: 17, name: 'Pesto', category: 'Pasta', image: '/images/menu/Pesto.png' },
  { id: 18, name: 'Classic Nachos', category: 'Snacks', image: '/images/menu/ClassicNachos.jpg' },
]

export const orders = [
  { id: 'CR-1048', customer: 'Mika Santos', type: 'Delivery', total: 455, status: 'Preparing', time: '10:24 AM', items: 3 },
  { id: 'CR-1047', customer: 'Aya Reyes', type: 'Pickup', total: 290, status: 'Ready', time: '10:17 AM', items: 2 },
  { id: 'CR-1046', customer: 'Noah Cruz', type: 'Walk-in', total: 155, status: 'Completed', time: '10:04 AM', items: 1 },
  { id: 'CR-1045', customer: 'Lia Tan', type: 'Delivery', total: 610, status: 'Pending', time: '9:52 AM', items: 4 },
]

export const inventory = [
  { name: 'Espresso beans', stock: 8.4, unit: 'kg', level: 74 },
  { name: 'Fresh milk', stock: 9, unit: 'L', level: 32 },
  { name: 'Vanilla syrup', stock: 1.2, unit: 'L', level: 18 },
  { name: '12oz cups', stock: 86, unit: 'pcs', level: 48 },
]
