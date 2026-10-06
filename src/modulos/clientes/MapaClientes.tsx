import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Crosshair, Eraser, Loader2, MapPin, Navigation, RotateCcw, Save } from 'lucide-react';
import { api, updateRecord } from '../../services/api';
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AvisoErro } from '../../components/AvisoErro';
import { consultaFiltro, type Cliente, type FiltroClientes, type OpcoesClientes } from './tipos';

/** Leaflet pelo CDN (como o TUniMap do Delphi), carregado uma vez só quando o mapa abre */
let leaflet: Promise<any> | null = null;
function carregarLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  return (leaflet ??= new Promise((ok, falha) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => ok(w.L);
    js.onerror = () => {
      leaflet = null;
      falha(new Error('Não foi possível carregar o mapa (Leaflet/OpenStreetMap).'));
    };
    document.head.appendChild(js);
  }));
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const virgula = (n: number) => String(n).replace('.', ',');

/** Endereço do cliente no cabeçalho do mapa (pan_endereco do Delphi) */
const linhaEndereco = (c: Cliente) => `${c.fantasia ?? ''} : ${c.endereco ?? ''}, ${c.endereco_nr ?? ''}, ${c.endereco_cidade ?? ''}, ${c.endereco_uf ?? ''}, Brazil`;

/** Texto do "Copiar Endereços": nome, endereço e link do Google Maps de cada cliente com coordenada */
export const textoEnderecos = (lista: Cliente[]) =>
  lista
    .filter((c) => Number(c.endereco_lat))
    .map((c) => `*${c.fantasia ?? ''}*\n${c.endereco ?? ''} ${c.endereco_nr ?? ''} ${c.endereco_cidade ?? ''}\nhttps://www.google.com.br/maps/@${Number(c.endereco_lat)},${Number(c.endereco_lon)},20z\n`)
    .join('\n');

/** Nominatim (OpenStreetMap): primeiro resultado do endereço */
async function geocodificar(q: string): Promise<{ lat: number; lon: number } | null> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(semAcento(q))}`).then((x) => x.json());
  return r?.length ? { lat: Number(r[0].lat), lon: Number(r[0].lon) } : null;
}

/**
 * Aba Mapa. Modo "multiplo" (botão Mapa): todos os clientes filtrados que têm coordenada.
 * Modo "unico" (duplo clique na coluna de coordenadas): o cliente, com o pino arrastável para gravar a posição.
 */
export const MapaClientes: React.FC<{
  modo: 'multiplo' | 'unico';
  cliente: Cliente | null;
  filtro: FiltroClientes;
  opcoes: OpcoesClientes | null;
  onVoltar: () => void;
  onGravou: () => void;
  onToast: (m: string) => void;
}> = ({ modo, cliente, filtro, opcoes, onVoltar, onGravou, onToast }) => {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<any>(null);
  const camada = useRef<any>(null);
  const [pronto, setPronto] = useState(false);
  const [lista, setLista] = useState<Cliente[] | null>(modo === 'unico' ? (cliente ? [cliente] : []) : null);
  const [lat, setLat] = useState(Number(cliente?.endereco_lat) || 0);
  const [lon, setLon] = useState(Number(cliente?.endereco_lon) || 0);
  const [aviso, setAviso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmaReset, setConfirmaReset] = useState(false);

  useEffect(() => {
    let vivo = true;
    carregarLeaflet()
      .then((L) => {
        if (!vivo || !div.current) return;
        mapa.current = L.map(div.current).setView([-15.8, -47.9], 4);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa.current);
        camada.current = L.layerGroup().addTo(mapa.current);
        setPronto(true);
      })
      .catch((e) => setErro(e.message));
    return () => {
      vivo = false;
      mapa.current?.remove();
      mapa.current = null;
    };
  }, []);

  useEffect(() => {
    if (modo !== 'multiplo') return;
    api
      .get<{ data: Cliente[] }>(`/api/clientes/lista?mapa=1&${consultaFiltro(filtro)}`)
      .then((r) => setLista(r.data))
      .catch((e) => setErro(e.message));
  }, [modo, filtro]);

  /** Botão Apontar: refaz a marcação no modo atual */
  const apontar = (pLat = lat, pLon = lon) => {
    const L = (window as any).L;
    if (!L || !mapa.current || !lista) return;
    camada.current.clearLayers();
    if (modo === 'unico') {
      if (!pLat || !cliente) return;
      const m = L.marker([pLat, pLon], { draggable: true }).addTo(camada.current);
      m.bindTooltip(String(cliente.fantasia || cliente.nome), { permanent: true, direction: 'top', offset: [-15, -10] });
      m.on('dragend', () => {
        const p = m.getLatLng();
        setLat(Number(p.lat.toFixed(7)));
        setLon(Number(p.lng.toFixed(7)));
      });
      mapa.current.flyTo([pLat, pLon], 15);
      return;
    }
    const pontos = lista.map((c) => {
      const p: [number, number] = [Number(c.endereco_lat), Number(c.endereco_lon)];
      L.marker(p).addTo(camada.current).bindTooltip(String(c.fantasia || c.nome), { permanent: true, direction: 'top', offset: [-15, -10] });
      return p;
    });
    if (pontos.length === 1) mapa.current.flyTo(pontos[0], 11);
    else if (pontos.length) mapa.current.fitBounds(pontos, { padding: [40, 40], maxZoom: 15 });
  };

  useEffect(() => {
    if (pronto) apontar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, lista]);

  const executar = async (rotulo: string, fn: () => Promise<void>) => {
    setOcupado(rotulo);
    setErro(null);
    try {
      await fn();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  const gravarCoordenadas = () =>
    executar('gravar', async () => {
      if (!lat || !cliente) return;
      await updateRecord('pessoas', cliente.id, { endereco_lat: lat.toFixed(7), endereco_lon: lon.toFixed(7) });
      setAviso(false);
      onGravou();
      onToast('Coordenadas gravadas.');
    });

  /** Resetar: zera a coordenada gravada (com confirmação) e procura o endereço no Nominatim; o novo ponto só é gravado no "Gravar" */
  const resetar = () =>
    executar('resetar', async () => {
      if (!cliente) return;
      setConfirmaReset(false);
      if (lat) {
        await updateRecord('pessoas', cliente.id, { endereco_lat: '0', endereco_lon: '0' });
        setLat(0);
        setLon(0);
        onGravou();
      }
      const cidade = [cliente.endereco_cidade, cliente.endereco_uf, 'Brazil'].filter(Boolean).join(' ');
      let p = await geocodificar([cliente.endereco, cliente.endereco_nr, cidade].filter(Boolean).join(' '));
      if (!p) {
        onToast(`Endereço não encontrado; procurando pela cidade: ${cidade}`);
        p = await geocodificar(cidade);
      }
      if (!p) throw new Error('Endereço e cidade não encontrados no OpenStreetMap.');
      setLat(p.lat);
      setLon(p.lon);
      setAviso(true);
      apontar(p.lat, p.lon);
    });

  const copiarEnderecos = async () => {
    const base = modo === 'unico' ? (cliente ? [cliente] : []) : lista ?? [];
    const texto = textoEnderecos(base);
    if (!texto) return onToast('Nenhum cliente com coordenadas para copiar.');
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const t = document.createElement('textarea');
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    onToast('Endereços copiados.');
  };

  /** Rotas: OpenStreetMap com o trajeto de carro da empresa ativa até o cliente */
  const rotas = () => {
    const e = opcoes?.empresa;
    const cLat = modo === 'unico' ? lat : Number(cliente?.endereco_lat) || 0;
    const cLon = modo === 'unico' ? lon : Number(cliente?.endereco_lon) || 0;
    if (!Number(e?.latitude)) return onToast('A empresa ativa não tem latitude/longitude (cadastre em Empresas).');
    if (!cLat) return onToast('O cliente não tem coordenadas.');
    window.open(
      `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${Number(e!.latitude)}%2C${Number(e!.longitude)}%3B${cLat}%2C${cLon}`,
      '_blank',
      'noopener',
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-2">
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onVoltar}>
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={() => apontar()} disabled={!pronto}>
          <Crosshair className="w-4 h-4" />
          Apontar
        </button>
        {modo === 'unico' && (
          <button type="button" className={BOTAO_PRIMARIO} onClick={gravarCoordenadas} disabled={!lat || !!ocupado}>
            {ocupado === 'gravar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Gravar Coordenadas
          </button>
        )}
        <button type="button" className={BOTAO_SECUNDARIO} onClick={() => camada.current?.clearLayers()} disabled={!pronto}>
          <Eraser className="w-4 h-4" />
          Limpar Marcadores
        </button>
        {modo === 'unico' && (
          <button type="button" className={BOTAO_SECUNDARIO} onClick={() => (lat ? setConfirmaReset(true) : resetar())} disabled={!!ocupado || !pronto}>
            {ocupado === 'resetar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Resetar Coordenadas
          </button>
        )}
        <button type="button" className={BOTAO_SECUNDARIO} onClick={copiarEnderecos}>
          <Copy className="w-4 h-4" />
          Copiar Endereços
        </button>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={rotas}>
          <Navigation className="w-4 h-4" />
          Rotas
        </button>
        <div className="ml-auto text-right text-xs min-w-0">
          <div className="font-semibold text-stone-700 dark:text-stone-200">
            Mapa dos Clientes
            {modo === 'unico' ? (
              <span className="font-mono font-normal text-stone-500 ml-2">
                Lat {virgula(lat)} · Lon {virgula(lon)}
              </span>
            ) : (
              <span className="font-normal text-stone-500 ml-2">{lista ? `${lista.length} cliente(s) com coordenadas` : 'carregando…'}</span>
            )}
          </div>
          {modo === 'unico' && cliente && <div className="text-[11px] text-stone-500 truncate">{linhaEndereco(cliente)}</div>}
        </div>
      </div>
      {aviso && (
        <div className="px-4 py-2 text-xs font-semibold bg-amber-50 text-amber-800 border-b border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900 flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          Ajuste o Pin e clique em Gravar Coordenadas
        </div>
      )}
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
      <div ref={div} className="flex-1 min-h-[320px] isolate z-0" />
      {confirmaReset && (
        <ConfirmDialog
          titulo="Resetar coordenadas?"
          mensagem="Confirma resetar coordenadas? A posição gravada do cliente é zerada e o endereço é procurado de novo no mapa."
          confirmar="Resetar"
          tom="normal"
          onConfirmar={resetar}
          onCancelar={() => setConfirmaReset(false)}
        />
      )}
    </div>
  );
};
