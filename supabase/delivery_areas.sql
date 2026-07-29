-- Canonical server-side delivery pricing.
-- The order RPC reads this table and never trusts a fee supplied by the client.

create table if not exists public.delivery_areas (
  barangay text primary key,
  zone text not null,
  fee numeric(12,2) not null check (fee >= 0),
  estimated_time text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.delivery_areas (barangay, zone, fee, estimated_time)
select barangay, 'Zone 1', 60, '10-20 mins'
from unnest(array[
  'Bagbag','Bahay Toro','Batasan Hills','Commonwealth','Holy Spirit','Payatas',
  'Bagong Silangan','Capri','Fairview','Greater Lagro','Gulod','Kaligayahan',
  'Nagkaisang Nayon','North Fairview','Novaliches Proper','Pasong Putik Proper',
  'San Agustin','San Bartolome','Sauyo','Santa Lucia','Santa Monica','Talipapa',
  'Tandang Sora','Culiat','Matandang Balara','Pasong Tamo'
]) as barangay
on conflict (barangay) do update set
  zone=excluded.zone, fee=excluded.fee, estimated_time=excluded.estimated_time,
  is_active=true, updated_at=now();

insert into public.delivery_areas (barangay, zone, fee, estimated_time)
select barangay, 'Zone 2', 80, '20-40 mins'
from unnest(array[
  'Alicia','Amihan','Apolonio Samson','Aurora','Bagong Pag-asa','Baesa',
  'Balingasa','Balintawak','Bambang','Bungad','Damar','Damayan','Damayang Lagi',
  'Del Monte','Dioquino Zobel','Don Manuel','Dona Aurora','Dona Faustina',
  'Dona Imelda','Dona Josefa','Duyan-Duyan','Immaculate Concepcion','Kaunlaran',
  'Lourdes','Maharlika','Manresa','Mariblo','Masambong','Milagrosa',
  'N.S. Amoranto','Nayon Kanluran','Paang Bundok','Pag-ibig sa Nayon','Paltok',
  'Paraiso','Phil-Am','Project 6','Ramon Magsaysay','Salvacion','San Antonio',
  'San Isidro Labrador','San Jose','San Martin de Porres','San Roque',
  'Santo Cristo','Santo Domingo','Talayan','Unang Sigaw','Veterans Village'
]) as barangay
on conflict (barangay) do update set
  zone=excluded.zone, fee=excluded.fee, estimated_time=excluded.estimated_time,
  is_active=true, updated_at=now();

insert into public.delivery_areas (barangay, zone, fee, estimated_time)
select barangay, 'Zone 3', 100, '40-60 mins'
from unnest(array[
  'Bagong Lipunan ng Crame','Bagumbayan','Bayanihan','Blue Ridge A','Blue Ridge B',
  'Botocan','Camp Aguinaldo','Central','East Kamias','Escopa I','Escopa II',
  'Escopa III','Escopa IV','Horseshoe','Kamuning','Kristong Hari','Krus na Ligas',
  'Laging Handa','Libis','Loyola Heights','Malaya','Mangga','Mariana',
  'Old Capitol Site','Paligsahan','Pinagkaisahan','Pinyahan','Quirino 2-A',
  'Quirino 2-B','Quirino 2-C','Quirino 3-A','Quirino 3-B','Roxas',
  'Sacred Heart','Saint Ignatius','Saint Peter','Santa Cruz','Santa Teresita',
  'Santo Nino','Santol','Sienna','Silangan','Socorro','South Triangle',
  'Tagumpay','Teachers Village East','Teachers Village West','Ugong Norte',
  'UP Campus','UP Village','Valencia','West Kamias','West Triangle','White Plains',
  'Kalusugan','New Era'
]) as barangay
on conflict (barangay) do update set
  zone=excluded.zone, fee=excluded.fee, estimated_time=excluded.estimated_time,
  is_active=true, updated_at=now();

alter table public.delivery_areas enable row level security;
drop policy if exists "Public reads active delivery areas" on public.delivery_areas;
create policy "Public reads active delivery areas" on public.delivery_areas
for select to anon, authenticated using (is_active = true);
grant select on public.delivery_areas to anon, authenticated;
