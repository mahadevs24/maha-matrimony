import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../environment';
export interface Profile {
  id: string;
  display_name: string;
  age: number;
  city: string;
  education: string;
  occupation: string;
  about: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string;
}
@Injectable({ providedIn: 'root' })
export class Backend {
  client: SupabaseClient | null =
    environment.supabaseUrl && environment.supabasePublishableKey
      ? createClient(environment.supabaseUrl, environment.supabasePublishableKey)
      : null;
  user = signal<User | null>(null);
  admin = signal(false);
  ready = signal(false);
  constructor() {
    if (!this.client) {
      this.ready.set(true);
      return;
    }
    this.client.auth.onAuthStateChange((_event, session) => {
      this.user.set(session?.user ?? null);
      this.admin.set(false);
    });
    void this.restore();
  }
  async restore() {
    const { data, error } = await this.client!.auth.getSession();
    if (!error) this.user.set(data.session?.user ?? null);
    this.ready.set(true);
  }
  async checkAdmin() {
    const { data, error } = await this.client!.rpc('is_admin');
    if (error) throw error;
    this.admin.set(data === true);
  }
}
