const zone = (name, fee, estimatedTime, barangays) =>
  barangays.map(barangay => ({ barangay, zone: name, fee, estimatedTime }))

export const deliveryZoneFees = {
  'Zone 1': 60,
  'Zone 2': 80,
  'Zone 3': 100,
  'Zone 4': 120,
}

export const deliveryAreas = [
  ...zone('Zone 1', deliveryZoneFees['Zone 1'], '10–20 mins', [
    'Bagbag', 'Bahay Toro', 'Batasan Hills', 'Commonwealth', 'Holy Spirit', 'Payatas',
    'Bagong Silangan', 'Capri', 'Fairview', 'Greater Lagro', 'Gulod', 'Kaligayahan',
    'Nagkaisang Nayon', 'North Fairview', 'Novaliches Proper', 'Pasong Putik Proper',
    'San Agustin', 'San Bartolome', 'Sauyo', 'Santa Lucia', 'Santa Monica', 'Talipapa',
    'Tandang Sora', 'Culiat', 'Matandang Balara', 'Pasong Tamo',
  ]),
  ...zone('Zone 2', deliveryZoneFees['Zone 2'], '20–40 mins', [
    'Alicia', 'Amihan', 'Apolonio Samson', 'Aurora', 'Bagong Pag-asa', 'Baesa',
    'Balingasa', 'Balintawak', 'Bambang', 'Bungad', 'Damar', 'Damayan', 'Damayang Lagi',
    'Del Monte', 'Dioquino Zobel', 'Don Manuel', 'Dona Aurora', 'Dona Faustina',
    'Dona Imelda', 'Dona Josefa', 'Duyan-Duyan', 'Immaculate Concepcion', 'Kaunlaran',
    'Lourdes', 'Maharlika', 'Manresa', 'Mariblo', 'Masambong', 'Milagrosa',
    'N.S. Amoranto', 'Nayon Kanluran', 'Paang Bundok', 'Pag-ibig sa Nayon', 'Paltok',
    'Paraiso', 'Phil-Am', 'Project 6', 'Ramon Magsaysay', 'Salvacion', 'San Antonio',
    'San Isidro Labrador', 'San Jose', 'San Martin de Porres', 'San Roque',
    'Santo Cristo', 'Santo Domingo', 'Talayan', 'Unang Sigaw', 'Veterans Village',
  ]),
  ...zone('Zone 3', deliveryZoneFees['Zone 3'], '40–60 mins', [
    'Bagong Lipunan ng Crame', 'Bagumbayan', 'Bayanihan', 'Blue Ridge A', 'Blue Ridge B',
    'Botocan', 'Camp Aguinaldo', 'Central', 'East Kamias', 'Escopa I', 'Escopa II',
    'Escopa III', 'Escopa IV', 'Horseshoe', 'Kamuning', 'Kristong Hari', 'Krus na Ligas',
    'Laging Handa', 'Libis', 'Loyola Heights', 'Malaya', 'Mangga', 'Mariana',
    'Old Capitol Site', 'Paligsahan', 'Pinagkaisahan', 'Pinyahan', 'Quirino 2-A',
    'Quirino 2-B', 'Quirino 2-C', 'Quirino 3-A', 'Quirino 3-B', 'Roxas',
    'Sacred Heart', 'Saint Ignatius', 'Saint Peter', 'Santa Cruz', 'Santa Teresita',
    'Santo Nino', 'Santol', 'Sienna', 'Silangan', 'Socorro', 'South Triangle',
    'Tagumpay', 'Teachers Village East', 'Teachers Village West', 'Ugong Norte',
    'UP Campus', 'UP Village', 'Valencia', 'West Kamias', 'West Triangle', 'White Plains',
    'Kalusugan', 'New Era',
  ]),
].sort((a, b) => a.barangay.localeCompare(b.barangay))
