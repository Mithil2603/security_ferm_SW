import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react';

/*
 * App-wide dropdowns, replacing native <select>.
 *
 *   <Select>        simple list. Takes <option>/<optgroup> children exactly like
 *                   a native select (or an `options` array) and calls
 *                   onChange({ target: { value, name } }), so existing handlers
 *                   such as `e => setX(e.target.value)` keep working.
 *   <GroupedSelect> collapsible groups: groups=[{ key, label, icon?, options }],
 *                   for long lists like the voucher ledger picker.
 *
 * Both: search box for longer lists, keyboard support (↑ ↓ Enter Esc, type to
 * search), native `required` validation, menu rendered in a portal so it is
 * never clipped by modals / overflow containers, and flips up near the bottom.
 */

const SEARCH_AT = 8; // show a search box from this many options

// ── children → options ─────────────────────────────────────────────────────
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
}

function parseChildren(children, groupLabel = null, out = []) {
  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) { parseChildren(child.props.children, groupLabel, out); return; }
    if (child.type === 'optgroup') { parseChildren(child.props.children, child.props.label, out); return; }
    if (child.type === 'option') {
      const label = textOf(child.props.children).replace(/\s+/g, ' ').trim();
      out.push({
        value: child.props.value !== undefined ? String(child.props.value) : label,
        label,
        disabled: !!child.props.disabled,
        group: groupLabel,
      });
    }
  });
  return out;
}

const norm = (o) => ({ ...o, value: o.value == null ? '' : String(o.value), label: o.label == null ? String(o.value ?? '') : String(o.label) });
const matches = (o, q) => !q || o.label.toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q);
const isPlaceholderLabel = (label) => /^(—|-|select|choose|pick)/i.test(label || '');

function fakeEvent(value, name) {
  const target = { value, name, type: 'select-one' };
  return { target, currentTarget: target, preventDefault() {}, stopPropagation() {} };
}

// ── shared machinery ───────────────────────────────────────────────────────
function useDropdown({ value, onChange, name, disabled, flatOptions }) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState('');
  const current = controlled ? (value == null ? '' : String(value)) : inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const seedRef = useRef('');

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 220);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 280 && above > below;
    const maxHeight = Math.max(160, Math.min(380, (up ? above : below) - 4));
    setPos({ left, width, maxHeight, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = (e) => { if (!menuRef.current?.contains(e.target)) place(); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);
  useEffect(() => {
    if (open) {
      setQuery(seedRef.current);
      seedRef.current = '';
      setTimeout(() => (searchRef.current || listRef.current)?.focus(), 0);
    }
  }, [open]);

  const choose = (opt) => {
    if (!opt || opt.disabled) return;
    const ev = fakeEvent(opt.value, name);
    onChange?.(ev);
    if (!controlled) setInner(ev.target.value); // lets a handler reset it (action menus)
    setOpen(false);
    triggerRef.current?.focus();
  };

  const toggle = () => { if (!disabled) setOpen((o) => !o); };
  const openWith = (key) => { if (disabled) return; seedRef.current = key; setOpen(true); };
  const selected = flatOptions.find((o) => o.value === current) || null;

  return {
    current, selected, open, setOpen, query, setQuery, active, setActive, pos,
    wrapRef, triggerRef, menuRef, searchRef, listRef, choose, toggle, openWith,
  };
}

function Trigger({ dd, id, disabled, required, className, style, fullWidth, placeholder, displayLabel, muted, clearable, onClear, ariaLabel, title, menuId }) {
  return (
    <div
      ref={dd.wrapRef}
      className={`inline-flex align-middle min-w-0 ${className || (style ? 'bg-white' : `bg-white border border-slate-200 rounded-lg hover:border-slate-300 ${fullWidth ? 'w-full' : 'min-w-[9rem]'}`)} ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${dd.open ? 'ring-2 ring-teal-500/30 !border-teal-500' : ''} focus-within:ring-2 focus-within:ring-teal-500/30`}
      style={style}
      title={title}
    >
      <button
        ref={dd.triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={dd.open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={dd.toggle}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); dd.setOpen(true); }
          else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); dd.openWith(e.key); }
        }}
        className="flex w-full min-w-0 items-center justify-between gap-2 bg-transparent border-0 outline-none text-left cursor-pointer disabled:cursor-not-allowed"
        style={{ padding: 0, font: 'inherit', color: 'inherit' }}
      >
        <span className={`truncate ${className || style ? '' : 'px-3 py-2 text-sm'} ${muted ? 'text-slate-400' : 'text-slate-800'}`}>
          {displayLabel || <span className="text-slate-400">{placeholder || 'Select...'}</span>}
        </span>
        <span className={`flex items-center gap-1 shrink-0 ${className || style ? '' : 'pr-2.5'}`}>
          {clearable && dd.current !== '' && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClear(); }}
              className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${dd.open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {/* Carries native `required` validation for the surrounding <form>. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={dd.current}
          onChange={() => {}}
          onInvalid={() => dd.triggerRef.current?.focus()}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}

function Menu({ dd, menuId, searchable, searchPlaceholder, children, footer, onKeyDown }) {
  if (!dd.open || !dd.pos) return null;
  const { maxHeight, ...rest } = dd.pos;
  return createPortal(
    <div
      ref={dd.menuRef}
      className="fixed z-[3000] bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-900/10 overflow-hidden flex flex-col"
      style={{ ...rest, maxHeight }}
      onKeyDown={onKeyDown}
    >
      {searchable && (
        <div className="p-2 border-b border-slate-100">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={dd.searchRef}
              value={dd.query}
              onChange={(e) => { dd.setQuery(e.target.value); dd.setActive(0); }}
              placeholder={searchPlaceholder || 'Search...'}
              className="w-full pl-8 pr-2 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
        </div>
      )}
      <div ref={dd.listRef} id={menuId} role="listbox" tabIndex={-1} className="overflow-y-auto py-1 outline-none">
        {children}
      </div>
      {footer}
    </div>,
    document.body
  );
}

function OptionRow({ opt, selected, active, onPick, onHover, indent, id }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={opt.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(opt)}
      onMouseEnter={onHover}
      className={`mx-1 flex items-center gap-2 rounded-lg py-2 pr-2 text-sm ${indent ? 'pl-7' : 'pl-3'} ${
        opt.disabled ? 'text-slate-300 cursor-not-allowed' : 'cursor-pointer'
      } ${active && !opt.disabled ? 'bg-teal-50' : ''} ${selected ? 'text-teal-700 font-medium' : 'text-slate-700'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{opt.label || ' '}</span>
        {opt.description && <span className="block truncate text-xs text-slate-400 font-normal">{opt.description}</span>}
      </span>
      {selected && <Check size={15} className="shrink-0 text-teal-600" />}
    </div>
  );
}

function scrollActiveIntoView(listRef, id) {
  const el = id && listRef.current?.querySelector(`[id="${id}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}

// ── Simple list ────────────────────────────────────────────────────────────
export default function Select({
  value, onChange, name, id, disabled, required, className, style, children, options: optionsProp,
  placeholder, searchable, searchPlaceholder, clearable = false, fullWidth = false, title, 'aria-label': ariaLabel,
}) {
  const options = useMemo(
    () => (optionsProp ? optionsProp.map(norm) : parseChildren(children)),
    [optionsProp, children]
  );
  const dd = useDropdown({ value, onChange, name, disabled, flatOptions: options });
  const menuId = useId();
  const q = dd.query.trim().toLowerCase();
  const showSearch = searchable ?? options.length >= SEARCH_AT;
  const visible = showSearch ? options.filter((o) => matches(o, q)) : options;

  useEffect(() => {
    if (dd.open) dd.setActive(Math.max(0, options.findIndex((o) => o.value === dd.current)));
  }, [dd.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (dd.open) scrollActiveIntoView(dd.listRef, `${menuId}-${dd.active}`); }, [dd.active, dd.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); dd.setOpen(false); dd.triggerRef.current?.focus(); }
    else if (e.key === 'Tab') dd.setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); dd.setActive((a) => Math.min(visible.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); dd.setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); dd.choose(visible[dd.active]); }
  };

  const shown = dd.selected || (value === undefined ? null : options[0]) || null;
  const label = shown?.label;
  let lastGroup = null;

  return (
    <>
      <Trigger dd={dd} id={id} disabled={disabled} required={required} className={className} style={style} fullWidth={fullWidth}
        placeholder={placeholder} displayLabel={label} muted={!dd.current && isPlaceholderLabel(label)}
        clearable={clearable} onClear={() => dd.choose({ value: '' })} ariaLabel={ariaLabel} title={title} menuId={menuId} />
      <Menu dd={dd} menuId={menuId} searchable={showSearch} searchPlaceholder={searchPlaceholder} onKeyDown={onKeyDown}>
        {visible.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-400">No matches</div>}
        {visible.map((o, i) => {
          const header = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          return (
            <Fragment key={`${o.value}-${i}`}>
              {header && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{header}</div>}
              <OptionRow id={`${menuId}-${i}`} opt={o} selected={o.value === dd.current} active={i === dd.active}
                onPick={dd.choose} onHover={() => dd.setActive(i)} indent={!!o.group} />
            </Fragment>
          );
        })}
      </Menu>
    </>
  );
}

// ── Collapsible groups ─────────────────────────────────────────────────────
export function GroupedSelect({
  value, onChange, name, id, disabled, required, className, style, groups = [], placeholder,
  searchPlaceholder, defaultExpanded = null, clearable = false, footerAction = null, fullWidth = true, title, 'aria-label': ariaLabel,
}) {
  const normGroups = useMemo(
    () => groups.map((g, gi) => ({ ...g, key: g.key ?? `g${gi}`, options: (g.options || []).map(norm) })).filter((g) => g.options.length > 0),
    [groups]
  );
  const flat = useMemo(() => normGroups.flatMap((g) => g.options.map((o) => ({ ...o, groupKey: g.key, groupLabel: g.label }))), [normGroups]);
  const dd = useDropdown({ value, onChange, name, disabled, flatOptions: flat });
  const menuId = useId();
  const [expanded, setExpanded] = useState(() => new Set());
  const q = dd.query.trim().toLowerCase();

  // On open: expand the selected option's group + the suggested ones
  // (all of them when the list is short).
  useEffect(() => {
    if (!dd.open) return;
    const next = new Set();
    if (flat.length <= 12) normGroups.forEach((g) => next.add(g.key));
    (defaultExpanded || []).forEach((k) => next.add(k));
    const sel = flat.find((o) => o.value === dd.current);
    if (sel) next.add(sel.groupKey);
    if (next.size === 0 && normGroups[0]) next.add(normGroups[0].key);
    setExpanded(next);
  }, [dd.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const searching = q.length > 0;
  const view = normGroups
    .map((g) => ({ ...g, visibleOptions: g.options.filter((o) => matches(o, q)) }))
    .filter((g) => !searching || g.visibleOptions.length > 0);
  const navigable = view.flatMap((g) => (searching || expanded.has(g.key) ? g.visibleOptions : []));

  useEffect(() => {
    if (dd.open) dd.setActive(Math.max(0, navigable.findIndex((o) => o.value === dd.current)));
  }, [dd.open, expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (dd.open) scrollActiveIntoView(dd.listRef, `${menuId}-o-${dd.active}`); }, [dd.active, dd.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (key) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const allOpen = view.length > 0 && view.every((g) => expanded.has(g.key));

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); dd.setOpen(false); dd.triggerRef.current?.focus(); }
    else if (e.key === 'Tab') dd.setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); dd.setActive((a) => Math.min(navigable.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); dd.setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); dd.choose(navigable[dd.active]); }
  };

  const sel = dd.selected;
  let n = -1;

  return (
    <>
      <Trigger dd={dd} id={id} disabled={disabled} required={required} className={className} style={style} fullWidth={fullWidth}
        placeholder={placeholder}
        displayLabel={sel ? (
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span className="truncate">{sel.label}</span>
            <span className="shrink-0 text-[11px] text-slate-400">{sel.groupLabel}</span>
          </span>
        ) : null}
        clearable={clearable} onClear={() => dd.choose({ value: '' })} ariaLabel={ariaLabel} title={title} menuId={menuId} />
      <Menu
        dd={dd}
        menuId={menuId}
        searchable
        searchPlaceholder={searchPlaceholder}
        onKeyDown={onKeyDown}
        footer={(
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 bg-slate-50/60">
            {!searching ? (
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => setExpanded(allOpen ? new Set() : new Set(view.map((g) => g.key)))}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 bg-transparent border-0 cursor-pointer p-0">
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            ) : <span className="text-xs text-slate-400">{navigable.length} match{navigable.length === 1 ? '' : 'es'}</span>}
            {footerAction && (
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { dd.setOpen(false); footerAction.onClick(); }}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 bg-transparent border-0 cursor-pointer p-0">
                {footerAction.label}
              </button>
            )}
          </div>
        )}
      >
        {view.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-400">No matches</div>}
        {view.map((g) => {
          const isOpen = searching || expanded.has(g.key);
          const Icon = g.icon;
          const hasSelected = g.options.some((o) => o.value === dd.current);
          return (
            <div key={g.key} className="py-0.5">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !searching && toggleGroup(g.key)}
                aria-expanded={isOpen}
                className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 bg-transparent border-0 text-left cursor-pointer hover:bg-slate-50"
              >
                <ChevronRight size={14} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                {Icon && <Icon size={14} className="shrink-0 text-slate-500" />}
                <span className={`flex-1 truncate text-xs font-semibold uppercase tracking-wide ${hasSelected ? 'text-teal-700' : 'text-slate-600'}`}>{g.label}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">
                  {searching ? g.visibleOptions.length : g.options.length}
                </span>
              </button>
              {isOpen && g.visibleOptions.map((o) => {
                n += 1;
                const idx = n;
                return (
                  <OptionRow key={o.value} id={`${menuId}-o-${idx}`} opt={o} selected={o.value === dd.current}
                    active={idx === dd.active} onPick={dd.choose} onHover={() => dd.setActive(idx)} indent />
                );
              })}
            </div>
          );
        })}
      </Menu>
    </>
  );
}
