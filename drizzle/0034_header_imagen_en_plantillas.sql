-- Fase 9P — header/footer opcionales para plantillas de WhatsApp
-- (HEADER IMAGE/TEXT, FOOTER). NULL = sin componentes especiales; las
-- plantillas existentes (incluida korex_prueba_template_001, creada en la
-- prueba de producción 9Q) quedan exactamente igual que antes.
ALTER TABLE "template" ADD COLUMN "components" jsonb;
