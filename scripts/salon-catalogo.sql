-- Catálogo del salón de belleza (primer cliente del vertical de citas).
--
-- FUENTE OFICIAL: "Catálogo lashes valen.pdf" (LASHES VALEN STUDIO), entregado
-- por la dueña el 8-ago-2026. Transcripción fiel, precio por precio, en
-- docs/korexia/32-CATALOGO-SALON.md. Todo lo de pestañas, efectos, cejas,
-- retoques y labios sale de ahí.
--
-- ⚠️ Las UÑAS no vienen en ese PDF (es el catálogo del área de lashes): las 12
-- de esta lista son las que ya estaban cargadas y siguen SIN confirmar contra
-- una fuente oficial.
-- ⚠️ Las DURACIONES tampoco vienen en el catálogo — son estimaciones. Hay que
-- confirmarlas con la dueña: de ellas depende toda la agenda.
--
-- Se carga sobre la organización de prueba para poder ejercitarlo antes del
-- alta real. Idempotente: borra el catálogo anterior de ESA organización.
BEGIN;

\set org 'org_novxv78s08h12arzatr2'

-- Fuera el catálogo anterior de esta organización y su personal.
DELETE FROM staff_service WHERE organization_id = :'org';
DELETE FROM appointment   WHERE organization_id = :'org';
DELETE FROM offered_slot  WHERE organization_id = :'org';
DELETE FROM service       WHERE organization_id = :'org';
DELETE FROM staff_member  WHERE organization_id = :'org';

-- ── Especialistas ────────────────────────────────────────────────────────
INSERT INTO staff_member (id, organization_id, name) VALUES
  ('stf_geimar',    :'org', 'Geimar'),
  ('stf_laura',     :'org', 'Laura'),
  ('stf_hilary',    :'org', 'Hilary'),
  ('stf_valentina', :'org', 'Valentina'),
  ('stf_carolina',  :'org', 'Carolina');

-- ── Servicios (price_cents = pesos × 100) ────────────────────────────────
INSERT INTO service (id, organization_id, name, category, price_cents, duration_min) VALUES
  -- 💅 Uñas — NO están en el catálogo oficial de lashes; sin confirmar.
  ('svc_u01', :'org', 'Uña individual',              'Uñas',  800000, 15),
  ('svc_u02', :'org', 'Tradicionales',               'Uñas', 2000000, 30),
  ('svc_u03', :'org', 'Semipermanente',              'Uñas', 4000000, 45),
  ('svc_u04', :'org', 'Base rubber',                 'Uñas', 5000000, 60),
  ('svc_u05', :'org', 'Diwpower',                    'Uñas', 6000000, 60),
  ('svc_u06', :'org', 'Baño de acrílico o poligel',  'Uñas', 7000000, 75),
  ('svc_u07', :'org', 'Retoque de acrílico',         'Uñas', 7500000, 45),
  ('svc_u08', :'org', 'Retoque de poligel',          'Uñas', 7500000, 45),
  ('svc_u09', :'org', 'Retoque de Press on',         'Uñas', 7500000, 45),
  ('svc_u10', :'org', 'Press on',                    'Uñas', 8000000, 60),
  ('svc_u11', :'org', 'Press on con baño',           'Uñas',10000000, 90),
  ('svc_u12', :'org', 'Acrílico o poligel',          'Uñas',10000000, 90),

  -- 👁️ Pestañas (montura nueva) — catálogo oficial, págs. 2 a 4
  ('svc_p01', :'org', 'Efecto Natural',              'Pestañas', 9500000, 120),
  ('svc_p02', :'org', 'Efecto Pestañina',            'Pestañas', 9500000, 120),
  ('svc_p03', :'org', 'Baby Volumen (2D)',           'Pestañas',11000000, 120),
  ('svc_p04', :'org', 'Volumen 3D',                  'Pestañas',12000000, 150),
  ('svc_p05', :'org', 'Volumen Ruso',                'Pestañas',13500000, 150),
  ('svc_p06', :'org', 'Volumen Americano',           'Pestañas',15000000, 180),
  ('svc_p07', :'org', 'Volumen 3D Tecnológico',      'Pestañas',12000000, 150),
  ('svc_p08', :'org', 'Volumen 4D Tecnológico',      'Pestañas',13500000, 150),
  ('svc_p09', :'org', 'Volumen 5D Tecnológico',      'Pestañas',15000000, 180),

  -- ✨ Efectos Modernos — catálogo oficial, pág. 5
  ('svc_e01', :'org', 'Foxy Eye',                    'Efectos Modernos',14000000, 150),
  ('svc_e02', :'org', 'Wispy',                       'Efectos Modernos',15000000, 150),
  ('svc_e03', :'org', 'Kim K',                       'Efectos Modernos',15000000, 150),

  -- 🪞 Cejas y Lifting — catálogo oficial, pág. 6
  ('svc_c01', :'org', 'Cejas en Henna',              'Cejas y Lifting', 3000000, 45),
  ('svc_c02', :'org', 'Lifting de pestañas',         'Cejas y Lifting', 8000000, 60),
  ('svc_c03', :'org', 'Laminado de cejas',           'Cejas y Lifting', 8000000, 60),

  -- 🔄 Retoques — catálogo oficial, págs. 7 a 9.
  -- Aplican solo si conserva el 60 % de las extensiones; pasados 30 días es
  -- montura nueva (va en el KB, no como servicio).
  ('svc_r01', :'org', 'Retoque Natural o Pestañina (10-15 días)',   'Retoques', 6000000,  60),
  ('svc_r02', :'org', 'Retoque Natural o Pestañina (20 días)',      'Retoques', 7500000,  75),
  ('svc_r03', :'org', 'Retoque Baby Volumen 2D (10-15 días)',       'Retoques', 7500000,  60),
  ('svc_r04', :'org', 'Retoque Baby Volumen 2D (20 días)',          'Retoques', 9000000,  75),
  ('svc_r05', :'org', 'Retoque Volumen 3D (10-15 días)',            'Retoques', 8000000,  60),
  ('svc_r06', :'org', 'Retoque Volumen 3D (20 días)',               'Retoques', 9500000,  75),
  ('svc_r07', :'org', 'Retoque Volumen Ruso (10-15 días)',          'Retoques', 9000000,  90),
  ('svc_r08', :'org', 'Retoque Volumen Ruso (20 días)',             'Retoques',11000000, 105),
  ('svc_r09', :'org', 'Retoque Volumen Americano (10-15 días)',     'Retoques',10000000,  90),
  ('svc_r10', :'org', 'Retoque Volumen Americano (20 días)',        'Retoques',12000000, 105),
  ('svc_r11', :'org', 'Retoque Volumen 3D Tecnológico (10-15 días)','Retoques', 7000000,  60),
  ('svc_r12', :'org', 'Retoque Volumen 3D Tecnológico (20 días)',   'Retoques', 8000000,  75),
  ('svc_r13', :'org', 'Retoque Volumen 4D Tecnológico (10-15 días)','Retoques', 7500000,  75),
  ('svc_r14', :'org', 'Retoque Volumen 4D Tecnológico (20 días)',   'Retoques', 9000000,  90),
  ('svc_r15', :'org', 'Retoque Volumen 5D Tecnológico (10-15 días)','Retoques', 9000000,  90),
  ('svc_r16', :'org', 'Retoque Volumen 5D Tecnológico (20 días)',   'Retoques',11000000, 105),
  ('svc_r17', :'org', 'Retiro de extensiones',                      'Retoques', 2000000,  30),

  -- 💋 Labios — catálogo oficial, pág. 10.
  -- Hidralips se vende de a mínimo 3 sesiones; el precio es POR SESIÓN.
  ('svc_l01', :'org', 'Henna Lips',                  'Labios', 2000000, 45),
  ('svc_l02', :'org', 'Hidralips',                   'Labios', 6000000, 60);

-- ── Quién atiende qué: POR CATEGORÍA, nadie cruza entre los dos grupos ───
-- Geimar y Laura: solo Uñas.
INSERT INTO staff_service (id, organization_id, staff_id, service_id)
SELECT 'ss_' || s.id || '_ge', :'org', 'stf_geimar', s.id
  FROM service s WHERE s.organization_id = :'org' AND s.category = 'Uñas';
INSERT INTO staff_service (id, organization_id, staff_id, service_id)
SELECT 'ss_' || s.id || '_la', :'org', 'stf_laura', s.id
  FROM service s WHERE s.organization_id = :'org' AND s.category = 'Uñas';

-- Hilary, Valentina y Carolina: todo lo que no es Uñas.
INSERT INTO staff_service (id, organization_id, staff_id, service_id)
SELECT 'ss_' || s.id || '_hi', :'org', 'stf_hilary', s.id
  FROM service s WHERE s.organization_id = :'org' AND s.category <> 'Uñas';
INSERT INTO staff_service (id, organization_id, staff_id, service_id)
SELECT 'ss_' || s.id || '_va', :'org', 'stf_valentina', s.id
  FROM service s WHERE s.organization_id = :'org' AND s.category <> 'Uñas';
INSERT INTO staff_service (id, organization_id, staff_id, service_id)
SELECT 'ss_' || s.id || '_ca', :'org', 'stf_carolina', s.id
  FROM service s WHERE s.organization_id = :'org' AND s.category <> 'Uñas';

COMMIT;

-- Esperado: Cejas y Lifting 3 · Efectos Modernos 3 · Labios 2 · Pestañas 9 ·
-- Retoques 17 · Uñas 12  = 46 servicios.
-- Geimar 12 · Laura 12 · Carolina 34 · Hilary 34 · Valentina 34.
SELECT category, count(*) AS servicios FROM service
 WHERE organization_id = 'org_novxv78s08h12arzatr2' GROUP BY 1 ORDER BY 1;
SELECT sm.name, count(*) AS atiende FROM staff_service ss
  JOIN staff_member sm ON sm.id = ss.staff_id
 WHERE ss.organization_id = 'org_novxv78s08h12arzatr2' GROUP BY 1 ORDER BY 1;
