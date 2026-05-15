-- ============================================================
-- 見積書・請求書アプリ — Supabase 用データベーススキーマ
-- ============================================================
-- 使い方:
--   1. Supabase ダッシュボード → SQL Editor を開く
--   2. このファイルの中身を全選択してコピー&ペースト
--   3. 右下の「Run」ボタンをクリック
-- ============================================================

-- 帳票テーブル（見積書・請求書を共通で格納）
create table if not exists public.documents (
  id text primary key,
  type text not null check (type in ('estimate', 'invoice')),
  issue_date date not null,
  due_date date,
  client jsonb not null default '{}'::jsonb,
  title text default '',
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(12, 2) default 0,
  tax numeric(12, 2) default 0,
  total numeric(12, 2) default 0,
  status text default 'draft' check (status in ('draft', 'unpaid', 'paid')),
  note text default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_documents_type on public.documents(type);
create index if not exists idx_documents_created_at on public.documents(created_at desc);

-- 自社情報テーブル（単一レコード）
create table if not exists public.issuer (
  id smallint primary key default 1,
  name text default '',
  address text default '',
  phone text default '',
  email text default '',
  updated_at timestamptz default now(),
  constraint issuer_single_row check (id = 1)
);

insert into public.issuer (id) values (1) on conflict do nothing;

-- updated_at 自動更新トリガー
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_documents_updated_at on public.documents;
create trigger trigger_documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

drop trigger if exists trigger_issuer_updated_at on public.issuer;
create trigger trigger_issuer_updated_at
  before update on public.issuer
  for each row execute function public.set_updated_at();

-- Row Level Security: 認証済ユーザーは全件アクセス可（5名以下の共有運用）
alter table public.documents enable row level security;
alter table public.issuer enable row level security;

drop policy if exists "auth_users_all_documents" on public.documents;
create policy "auth_users_all_documents" on public.documents
  for all to authenticated using (true) with check (true);

drop policy if exists "auth_users_all_issuer" on public.issuer;
create policy "auth_users_all_issuer" on public.issuer
  for all to authenticated using (true) with check (true);
