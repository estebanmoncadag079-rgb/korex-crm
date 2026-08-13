"use client";

import Link from "next/link";
import { ArrowRight, Pencil, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/*
 * El `Button` de este proyecto no acepta `asChild`, así que un enlace con
 * pinta de botón se estila a mano. Se mantienen las mismas clases que usa el
 * componente para que no desentone si algún día cambia el diseño.
 */
const BOTON =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
const BOTON_PRIMARIO = `${BOTON} h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90`;
const BOTON_SECUNDARIO = `${BOTON} h-8 px-3 border bg-background hover:bg-accent hover:text-accent-foreground`;

/**
 * La puerta de entrada a la configuración inicial, dentro de la pestaña Agente.
 *
 * Va aquí porque es donde el dueño de un negocio busca "cómo configuro mi bot".
 * Antes, un cliente recién dado de alta llegaba a esta pantalla y se encontraba
 * campos vacíos con nombres técnicos ("instrucciones del sistema", "reglas de
 * escalado") que no significan nada para quien vende pan. Ahora encuentra una
 * invitación en su idioma.
 *
 * Cambia de cara según el estado, porque son dos necesidades distintas:
 *  - **Sin configurar** → invitación grande: es lo primero que tiene que hacer.
 *  - **Ya configurado** → un enlace discreto para corregir un precio o el
 *    horario sin volver a empezar de cero.
 */
export function EntrenamientoCard({ configurado }: { configurado: boolean }) {
  if (configurado) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              ¿Cambió un precio, tu horario o alguna regla de tu negocio?
            </p>
          </div>
          <Link href="/configuracion-inicial" className={BOTON_SECUNDARIO}>
            Ajustar mi asistente
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Empecemos a entrenar tu asistente</CardTitle>
        </div>
        <CardDescription className="text-[15px]">
          Cuéntanos cómo funciona tu negocio —qué vendes, tu horario, cómo te
          pagan— y dejamos tu asistente listo para atender por WhatsApp. Son 8
          pasos cortos y puedes salir y seguir cuando quieras.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/configuracion-inicial" className={BOTON_PRIMARIO}>
          Comenzar <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
