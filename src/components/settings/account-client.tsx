"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * Cambio de contraseña. Es el cierre del alta de cuentas: la agencia entrega
 * una contraseña temporal a mano, así que quien la recibe necesita poder
 * cambiarla sin pedirle nada a nadie.
 */
export function AccountClient({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = repeat.length > 0 && next !== repeat;

  async function submit() {
    setSaving(true);
    setError(null);
    setDone(false);
    const { error: err } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      // Cerrar el resto de sesiones: si la contraseña vieja se filtró, quien
      // la tuviera queda fuera al instante.
      revokeOtherSessions: true,
    });
    setSaving(false);
    if (err) {
      setError(
        err.status === 400 || err.status === 401
          ? "La contraseña actual no es correcta."
          : "No se pudo cambiar la contraseña."
      );
      return;
    }
    setCurrent("");
    setNext("");
    setRepeat("");
    setDone(true);
  }

  return (
    <div className="max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cambiar contraseña</CardTitle>
          <CardDescription>
            Tu cuenta es <strong>{email}</strong>. Al cambiarla se cierran las
            demás sesiones abiertas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Contraseña actual</Label>
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Contraseña nueva</Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            {tooShort && (
              <p className="text-xs text-destructive">
                Debe tener al menos 8 caracteres.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repeat-password">Repite la nueva</Label>
            <PasswordInput
              id="repeat-password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
            {mismatch && (
              <p className="text-xs text-destructive">Las dos no coinciden.</p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {done && (
            <p className="text-sm text-[#3f6b52]">
              Contraseña cambiada ✓ Guárdala en un lugar seguro.
            </p>
          )}
          <Button
            className="w-full sm:w-auto"
            disabled={
              saving ||
              !current ||
              next.length < 8 ||
              next !== repeat
            }
            onClick={() => void submit()}
          >
            <KeyRound className="h-4 w-4" />
            {saving ? "Cambiando…" : "Cambiar contraseña"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
