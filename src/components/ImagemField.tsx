import React, { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { enviarArquivo } from '../services/api';
import { ConfirmDialog } from './ConfirmDialog';

/** Lado maior da imagem gravada: suficiente para miniatura e PDF, sem pesar no storage */
const LADO_MAX = 800;

/** Reduz a imagem no navegador (canvas) e devolve um JPEG em data URI */
async function reduzir(arquivo: File): Promise<string> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // PNG transparente vira fundo branco no JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Foto opcional do catálogo: envia ao escolher; o valor do campo é o caminho público (/imagens/...) */
export const ImagemField: React.FC<{ id: string; value: string; onChange: (v: string) => void }> = ({ id, value, onChange }) => {
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState(false);

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setErro(null);
    setEnviando(true);
    try {
      const dados = await (await fetch(await reduzir(arquivo))).blob();
      onChange(await enviarArquivo(`imagens/${Date.now()}.jpg`, new File([dados], 'imagem.jpg', { type: 'image/jpeg' })));
    } catch (e: any) {
      setErro(e.message || 'Não foi possível enviar a imagem.');
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        id={id}
        onClick={() => input.current?.click()}
        title={value ? 'Trocar a imagem' : 'Escolher uma imagem'}
        className="w-24 h-24 shrink-0 rounded-lg border border-dashed border-stone-300 dark:border-stone-700 flex items-center justify-center overflow-hidden bg-stone-50 dark:bg-stone-800 cursor-pointer hover:border-blue-400"
      >
        {enviando ? (
          <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
        ) : value ? (
          <img src={value} alt="" className="w-full h-full object-contain" />
        ) : (
          <ImagePlus className="w-6 h-6 text-stone-400" />
        )}
      </button>
      {value && !enviando && (
        <button
          type="button"
          onClick={() => setRemovendo(true)}
          title="Remover a imagem"
          className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      {erro && <span className="text-xs text-rose-600">{erro}</span>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
      {removendo && (
        <ConfirmDialog
          titulo="Remover a imagem"
          mensagem="A imagem sai do cadastro ao salvar. Continuar?"
          confirmar="Remover"
          onConfirmar={async () => {
            onChange('');
            setRemovendo(false);
          }}
          onCancelar={() => setRemovendo(false)}
        />
      )}
    </div>
  );
};
